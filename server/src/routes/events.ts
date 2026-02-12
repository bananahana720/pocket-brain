import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { subscribeSyncEvents } from '../realtime/hub.js';
import {
  getStreamTicketCookieOptions,
  issueStreamTicket,
  STREAM_TICKET_COOKIE_NAME,
} from '../auth/streamTicket.js';

function writeSseChunk(raw: NodeJS.WritableStream, payload: string): void {
  raw.write(payload);
}

function shouldForceCloseForTests(headerValue: string | string[] | undefined): boolean {
  if (env.NODE_ENV !== 'test') return false;
  if (headerValue === '1') return true;
  return Array.isArray(headerValue) && headerValue.length === 1 && headerValue[0] === '1';
}

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v2/events/ticket', async (request, reply) => {
    const issued = issueStreamTicket({
      subject: request.auth.clerkUserId,
      deviceId: request.deviceId,
      ttlSeconds: env.STREAM_TICKET_TTL_SECONDS,
    });

    reply.setCookie(STREAM_TICKET_COOKIE_NAME, issued.token, getStreamTicketCookieOptions(request));
    return {
      ok: true,
      expiresAt: issued.expiresAt,
    };
  });

  app.get('/api/v2/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    writeSseChunk(reply.raw, `event: ready\ndata: ${JSON.stringify({ connectedAt: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
      writeSseChunk(reply.raw, `event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    }, 20_000);

    const unsubscribe = subscribeSyncEvents(event => {
      if (event.userId !== request.appUserId) return;
      writeSseChunk(reply.raw, `event: sync\ndata: ${JSON.stringify({ cursor: event.cursor, ts: event.emittedAt })}\n\n`);
    });

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    // Deterministic SSE shutdown for integration tests only.
    if (shouldForceCloseForTests(request.headers['x-sse-test-close'])) {
      cleanup();
      reply.raw.end();
      return reply;
    }

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    return reply;
  });
}
