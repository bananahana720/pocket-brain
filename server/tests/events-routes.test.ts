import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEventRoutes } from '../src/routes/events.js';
import * as streamTicket from '../src/auth/streamTicket.js';

const TEST_SUB = 'user_events_1';
const TEST_DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function buildEventsApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);

  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url === '/api/v2/events/ticket') {
      (request as any).auth = { clerkUserId: TEST_SUB, tokenSub: TEST_SUB, authMode: 'clerk' };
      (request as any).deviceId = TEST_DEVICE_ID;
      (request as any).appUserId = 'app-user-events-1';
      return;
    }

    if (request.routeOptions.url !== '/api/v2/events') return;

    const rawTicket = request.cookies?.[streamTicket.STREAM_TICKET_COOKIE_NAME];
    if (!rawTicket) {
      reply.code(401).send({
        error: {
          code: 'STREAM_TICKET_REQUIRED',
          message: 'Stream ticket required',
          retryable: false,
        },
      });
      return;
    }

    try {
      const claims = await streamTicket.consumeStreamTicket(rawTicket);
      if (claims.sub !== TEST_SUB || claims.deviceId !== TEST_DEVICE_ID) {
        reply.code(403).send({
          error: {
            code: 'STREAM_TICKET_MISMATCH',
            message: 'Stream ticket identity mismatch',
            retryable: false,
          },
        });
        return;
      }
      (request as any).appUserId = 'app-user-events-1';
    } catch (error) {
      if (error instanceof streamTicket.StreamTicketError) {
        reply.code(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        });
        return;
      }
      throw error;
    }
  });

  await registerEventRoutes(app);
  return app;
}

describe('event routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues stream ticket cookie from POST /api/v2/events/ticket', async () => {
    const app = await buildEventsApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v2/events/ticket',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true });
      const cookieHeader = response.headers['set-cookie'];
      expect(typeof cookieHeader).toBe('string');
      expect(String(cookieHeader)).toContain(`${streamTicket.STREAM_TICKET_COOKIE_NAME}=`);
      expect(String(cookieHeader)).toContain('Path=/api/v2/events');
    } finally {
      await app.close();
    }
  });

  it('accepts valid stream ticket for GET /api/v2/events', async () => {
    const app = await buildEventsApp();
    try {
      const { token } = streamTicket.issueStreamTicket({
        subject: TEST_SUB,
        deviceId: TEST_DEVICE_ID,
        ttlSeconds: 120,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/events',
        cookies: {
          [streamTicket.STREAM_TICKET_COOKIE_NAME]: token,
        },
        headers: {
          'x-sse-test-close': '1',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('event: ready');
    } finally {
      await app.close();
    }
  });

  it('rejects missing stream ticket', async () => {
    const app = await buildEventsApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/events',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('STREAM_TICKET_REQUIRED');
    } finally {
      await app.close();
    }
  });

  it('rejects expired stream ticket', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const app = await buildEventsApp();
    try {
      const { token } = streamTicket.issueStreamTicket({
        subject: TEST_SUB,
        deviceId: TEST_DEVICE_ID,
        ttlSeconds: 30,
      });

      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/events',
        cookies: {
          [streamTicket.STREAM_TICKET_COOKIE_NAME]: token,
        },
        simulate: {
          close: true,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('STREAM_TICKET_EXPIRED');
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it('rejects stream ticket user/device mismatch', async () => {
    const app = await buildEventsApp();
    try {
      const { token } = streamTicket.issueStreamTicket({
        subject: 'different-user',
        deviceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ttlSeconds: 120,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/events',
        cookies: {
          [streamTicket.STREAM_TICKET_COOKIE_NAME]: token,
        },
        simulate: {
          close: true,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('STREAM_TICKET_MISMATCH');
    } finally {
      await app.close();
    }
  });

  it('returns 503 when stream ticket replay store is unavailable', async () => {
    const app = await buildEventsApp();
    const consumeSpy = vi
      .spyOn(streamTicket, 'consumeStreamTicket')
      .mockRejectedValueOnce(
        new streamTicket.StreamTicketError(
          'STREAM_TICKET_STORAGE_UNAVAILABLE',
          'Stream auth store unavailable. Please retry.',
          503,
          true
        )
      );

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/events',
        cookies: {
          [streamTicket.STREAM_TICKET_COOKIE_NAME]: 'mock-token',
        },
        simulate: {
          close: true,
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('STREAM_TICKET_STORAGE_UNAVAILABLE');
      expect(response.json().error.retryable).toBe(true);
    } finally {
      consumeSpy.mockRestore();
      await app.close();
    }
  });

  it('keeps stream endpoint available in best-effort mode when replay store is degraded and records telemetry', async () => {
    const { redis } = await import('../src/db/client.js');
    const { getStreamTicketReplayTelemetry, resetStreamTicketReplayTelemetryForTests } = await import(
      '../src/auth/streamTicketTelemetry.js'
    );
    resetStreamTicketReplayTelemetryForTests();
    vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('redis unavailable'));

    const app = await buildEventsApp();
    try {
      const { token } = streamTicket.issueStreamTicket({
        subject: TEST_SUB,
        deviceId: TEST_DEVICE_ID,
        ttlSeconds: 120,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/events',
        cookies: {
          [streamTicket.STREAM_TICKET_COOKIE_NAME]: token,
        },
        headers: {
          'x-sse-test-close': '1',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: ready');

      const telemetry = getStreamTicketReplayTelemetry();
      expect(telemetry.mode).toBe('best-effort');
      expect(telemetry.degraded).toBe(true);
      expect(telemetry.failOpenBypasses).toBe(1);
      expect(telemetry.storageUnavailableErrors).toBe(0);
    } finally {
      await app.close();
    }
  });
});
