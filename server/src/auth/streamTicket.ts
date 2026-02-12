import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { env } from '../config/env.js';
import { redis } from '../db/client.js';

export const STREAM_TICKET_COOKIE_NAME = 'pb_stream_ticket';

interface StreamTicketClaims {
  sub: string;
  deviceId: string;
  iat: number;
  exp: number;
  jti: string;
}

type StreamTicketErrorCode =
  | 'STREAM_TICKET_REQUIRED'
  | 'STREAM_TICKET_INVALID'
  | 'STREAM_TICKET_EXPIRED'
  | 'STREAM_TICKET_REPLAYED'
  | 'STREAM_TICKET_STORAGE_UNAVAILABLE';

export class StreamTicketError extends Error {
  code: StreamTicketErrorCode;
  statusCode: number;
  retryable: boolean;

  constructor(code: StreamTicketErrorCode, message: string, statusCode: number, retryable = false) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function safeBase64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function sign(input: string): string {
  return crypto.createHmac('sha256', env.STREAM_TICKET_SECRET).update(input).digest('base64url');
}

function parseClaims(raw: string): StreamTicketClaims {
  let parsed: StreamTicketClaims;
  try {
    parsed = JSON.parse(raw) as StreamTicketClaims;
  } catch {
    throw new StreamTicketError('STREAM_TICKET_INVALID', 'Stream ticket is malformed', 401);
  }

  const hasValidShape =
    parsed &&
    typeof parsed.sub === 'string' &&
    parsed.sub.trim().length > 0 &&
    typeof parsed.deviceId === 'string' &&
    parsed.deviceId.trim().length > 0 &&
    typeof parsed.iat === 'number' &&
    Number.isFinite(parsed.iat) &&
    typeof parsed.exp === 'number' &&
    Number.isFinite(parsed.exp) &&
    typeof parsed.jti === 'string' &&
    parsed.jti.trim().length > 0;

  if (!hasValidShape) {
    throw new StreamTicketError('STREAM_TICKET_INVALID', 'Stream ticket is malformed', 401);
  }

  return parsed;
}

async function markTicketConsumed(jti: string, expSeconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(1, expSeconds - now);
  const key = `sse_ticket:${jti}`;

  try {
    const response = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    if (response !== 'OK') {
      throw new StreamTicketError('STREAM_TICKET_REPLAYED', 'Stream ticket was already used', 401);
    }
  } catch (error) {
    if (error instanceof StreamTicketError) {
      throw error;
    }

    if (env.NODE_ENV === 'production') {
      throw new StreamTicketError(
        'STREAM_TICKET_STORAGE_UNAVAILABLE',
        'Stream auth store unavailable. Please retry.',
        503,
        true
      );
    }
  }
}

export function issueStreamTicket(args: {
  subject: string;
  deviceId: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: number } {
  const ttlSeconds = args.ttlSeconds || env.STREAM_TICKET_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const claims: StreamTicketClaims = {
    sub: args.subject,
    deviceId: args.deviceId,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'PBST' }));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signature = sign(`${encodedHeader}.${encodedClaims}`);

  return {
    token: `${encodedHeader}.${encodedClaims}.${signature}`,
    expiresAt: claims.exp * 1000,
  };
}

export async function consumeStreamTicket(token: string): Promise<StreamTicketClaims> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new StreamTicketError('STREAM_TICKET_REQUIRED', 'Stream ticket is required', 401);
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new StreamTicketError('STREAM_TICKET_INVALID', 'Stream ticket is malformed', 401);
  }

  const [encodedHeader, encodedClaims, incomingSignature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedClaims}`);
  const expectedBuffer = Buffer.from(expectedSignature);
  const incomingBuffer = Buffer.from(incomingSignature);
  if (
    expectedBuffer.length !== incomingBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, incomingBuffer)
  ) {
    throw new StreamTicketError('STREAM_TICKET_INVALID', 'Stream ticket signature is invalid', 401);
  }

  const rawClaims = safeBase64UrlDecode(encodedClaims);
  if (!rawClaims) {
    throw new StreamTicketError('STREAM_TICKET_INVALID', 'Stream ticket is malformed', 401);
  }

  const claims = parseClaims(rawClaims);
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new StreamTicketError('STREAM_TICKET_EXPIRED', 'Stream ticket expired', 401);
  }

  await markTicketConsumed(claims.jti, claims.exp);
  return claims;
}

export function getStreamTicketCookieOptions(request: FastifyRequest): CookieSerializeOptions {
  const hostname = request.hostname || '';
  const secure = !isLoopbackHost(hostname);
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/v2/events',
    maxAge: env.STREAM_TICKET_TTL_SECONDS,
  };
}
