import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STREAM_TICKET_COOKIE_NAME } from '../src/auth/streamTicket.js';

const TEST_USER_ID = 'integration-user-events';
const TEST_DEVICE_ID = '11111111-1111-4111-8111-111111111111';

const ensureUserMock = vi.hoisted(() => vi.fn());
const upsertDeviceMock = vi.hoisted(() => vi.fn());
const assertDeviceActiveMock = vi.hoisted(() => vi.fn());
const subscribeSyncEventsMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/users.js', () => ({
  ensureUser: ensureUserMock,
}));

vi.mock('../src/services/devices.js', () => ({
  upsertDevice: upsertDeviceMock,
  assertDeviceActive: assertDeviceActiveMock,
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
}));

vi.mock('../src/realtime/hub.js', async () => {
  const actual = await vi.importActual<typeof import('../src/realtime/hub.js')>('../src/realtime/hub.js');
  return {
    ...actual,
    subscribeSyncEvents: subscribeSyncEventsMock,
  };
});

function extractCookieValue(
  headerValue: string | string[] | undefined,
  cookieName: string
): string | null {
  const cookies = Array.isArray(headerValue) ? headerValue : headerValue ? [headerValue] : [];

  for (const cookie of cookies) {
    const firstSegment = cookie.split(';')[0];
    const separatorIndex = firstSegment.indexOf('=');
    if (separatorIndex <= 0) continue;

    const name = firstSegment.slice(0, separatorIndex);
    if (name !== cookieName) continue;

    return firstSegment.slice(separatorIndex + 1);
  }

  return null;
}

describe('events stream ticket integration (buildServer)', () => {
  let app: FastifyInstance | null = null;

  beforeEach(async () => {
    ensureUserMock.mockReset();
    upsertDeviceMock.mockReset();
    assertDeviceActiveMock.mockReset();
    subscribeSyncEventsMock.mockReset();

    ensureUserMock.mockResolvedValue({ id: 'app-user-events-1', clerkUserId: TEST_USER_ID });
    upsertDeviceMock.mockResolvedValue(undefined);
    assertDeviceActiveMock.mockResolvedValue(undefined);
    subscribeSyncEventsMock.mockReturnValue(() => undefined);

    const { redis } = await import('../src/db/client.js');
    const consumedTickets = new Set<string>();
    vi.spyOn(redis, 'set').mockImplementation(async (...args: any[]) => {
      const key = String(args[0] || '');
      if (consumedTickets.has(key)) {
        return null;
      }
      consumedTickets.add(key);
      return 'OK';
    });

    const { buildServer } = await import('../src/index.js');
    app = await buildServer();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('supports POST /api/v2/events/ticket then GET /api/v2/events through the real preHandler chain', async () => {
    const ticketResponse = await app!.inject({
      method: 'POST',
      url: '/api/v2/events/ticket',
      headers: {
        'x-dev-user-id': TEST_USER_ID,
        'x-device-id': TEST_DEVICE_ID,
      },
    });

    expect(ticketResponse.statusCode).toBe(200);
    const streamTicket = extractCookieValue(ticketResponse.headers['set-cookie'], STREAM_TICKET_COOKIE_NAME);
    expect(streamTicket).toBeTruthy();

    const streamResponse = await app!.inject({
      method: 'GET',
      url: '/api/v2/events',
      cookies: {
        [STREAM_TICKET_COOKIE_NAME]: streamTicket!,
      },
      headers: {
        'x-sse-test-close': '1',
      },
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers['content-type']).toContain('text/event-stream');
    expect(streamResponse.body).toContain('event: ready');
    expect(ensureUserMock).toHaveBeenCalledTimes(2);
    expect(upsertDeviceMock).toHaveBeenCalledTimes(2);
    expect(assertDeviceActiveMock).toHaveBeenCalledTimes(2);
    expect(upsertDeviceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: 'app-user-events-1',
        deviceId: TEST_DEVICE_ID,
      })
    );
  });

  it('requires stream ticket for /api/v2/events even when legacy query token is provided', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v2/events?token=legacy-token',
      headers: {
        Authorization: 'Bearer legacy-token',
        'x-dev-user-id': TEST_USER_ID,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: 'STREAM_TICKET_REQUIRED',
        message: 'Stream ticket required before opening events stream',
        retryable: false,
      },
    });
    expect(ensureUserMock).not.toHaveBeenCalled();
  });

  it('rejects replayed stream tickets on second GET /api/v2/events attempt', async () => {
    const ticketResponse = await app!.inject({
      method: 'POST',
      url: '/api/v2/events/ticket',
      headers: {
        'x-dev-user-id': TEST_USER_ID,
        'x-device-id': TEST_DEVICE_ID,
      },
    });

    const streamTicket = extractCookieValue(ticketResponse.headers['set-cookie'], STREAM_TICKET_COOKIE_NAME);
    expect(streamTicket).toBeTruthy();

    const firstOpen = await app!.inject({
      method: 'GET',
      url: '/api/v2/events',
      cookies: {
        [STREAM_TICKET_COOKIE_NAME]: streamTicket!,
      },
      headers: {
        'x-sse-test-close': '1',
      },
    });
    expect(firstOpen.statusCode).toBe(200);

    const replayOpen = await app!.inject({
      method: 'GET',
      url: '/api/v2/events',
      cookies: {
        [STREAM_TICKET_COOKIE_NAME]: streamTicket!,
      },
      simulate: {
        close: true,
      },
    });

    expect(replayOpen.statusCode).toBe(401);
    expect(replayOpen.json()).toEqual({
      error: {
        code: 'STREAM_TICKET_REPLAYED',
        message: 'Stream ticket was already used',
        retryable: false,
      },
    });
  });
});
