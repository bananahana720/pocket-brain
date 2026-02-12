import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index.ts';

function createEnv(overrides: Partial<Record<string, string>> = {}) {
  return {
    AI_SESSIONS: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
    CONTROL_PLANE_DO: {
      idFromName() {
        return {} as any;
      },
      get() {
        return {
          async fetch() {
            return new Response(JSON.stringify({ blocked: false, blockedUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        } as any;
      },
    },
    KEY_ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef',
    VPS_API_ORIGIN: 'http://vps.example',
    VPS_PROXY_TIMEOUT_MS: '10000',
    VPS_PROXY_RETRIES: '2',
    ...overrides,
  } as any;
}

describe('worker /api/v2 proxy resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries transient upstream failures for non-event sync routes', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ changes: [], nextCursor: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/sync/pull?cursor=0'),
      createEnv()
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry event stream handshakes', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('upstream down', { status: 503 }));

    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/events'),
      createEnv()
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(payload.error.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps repeated timeout failures to structured SERVICE_UNAVAILABLE', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));

    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/sync/pull?cursor=10'),
      createEnv()
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(payload.error.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('opens a short VPS proxy circuit after repeated failures and then fails fast', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('upstream down', { status: 503 }));

    const env = createEnv({
      VPS_PROXY_RETRIES: '0',
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await worker.fetch(
        new Request(`https://worker.example/api/v2/sync/pull?cursor=${attempt}`),
        env
      );
      expect(response.status).toBe(503);
    }

    const callsBeforeOpenReject = fetchMock.mock.calls.length;
    const fastFail = await worker.fetch(
      new Request('https://worker.example/api/v2/sync/pull?cursor=99'),
      env
    );
    const payload = await fastFail.json();

    expect(fastFail.status).toBe(503);
    expect(payload.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(payload.error.retryable).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeOpenReject);
  });
});
