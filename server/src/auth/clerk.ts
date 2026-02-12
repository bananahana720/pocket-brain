import { verifyToken } from '@clerk/backend';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function parseJwtSub(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub : null;
  } catch {
    return null;
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function extractQueryToken(request: FastifyRequest): string | null {
  try {
    const origin = request.headers.host ? `http://${request.headers.host}` : 'http://localhost';
    const url = new URL(request.raw.url || '/', origin);
    const token = url.searchParams.get('token');
    return token && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export async function resolveIdentity(request: FastifyRequest): Promise<{ clerkUserId: string; tokenSub: string; authMode: 'clerk' | 'dev' }> {
  const token = extractBearerToken(request) || extractQueryToken(request);
  const allowDevAuth = env.NODE_ENV !== 'production' && env.ALLOW_INSECURE_DEV_AUTH;

  if (token) {
    if (env.CLERK_SECRET_KEY) {
      try {
        const verified = await verifyToken(token, {
          secretKey: env.CLERK_SECRET_KEY,
        });

        if (typeof verified.sub === 'string' && verified.sub) {
          return {
            clerkUserId: verified.sub,
            tokenSub: verified.sub,
            authMode: 'clerk',
          };
        }
      } catch {
        if (!allowDevAuth) {
          throw new Error('Unauthorized');
        }
      }
    }

    if (allowDevAuth) {
      const sub = parseJwtSub(token);
      if (sub && sub.trim()) {
        return {
          clerkUserId: sub,
          tokenSub: sub,
          authMode: 'dev',
        };
      }
    }
  }

  if (allowDevAuth) {
    const devUser = (request.headers['x-dev-user-id'] as string | undefined) || env.AUTH_DEV_USER_ID;
    return {
      clerkUserId: devUser,
      tokenSub: devUser,
      authMode: 'dev',
    };
  }

  throw new Error('Unauthorized');
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    request.auth = await resolveIdentity(request);
  } catch {
    reply.code(401).send({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
        retryable: false,
      },
    });
  }
}
