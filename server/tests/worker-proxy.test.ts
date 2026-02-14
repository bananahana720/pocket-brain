import { afterEach, describe, expect, it, vi } from 'vitest';

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
    VPS_API_ORIGIN: 'https://vps.example',
    VPS_PROXY_TIMEOUT_MS: '7000',
    VPS_PROXY_RETRIES: '1',
    ...overrides,
  } as any;
}

async function readDiagnosticsMetrics(
  worker: Awaited<ReturnType<typeof loadWorker>>,
  envOverrides: Partial<Record<string, string>> = {}
) {
  const response = await worker.fetch(
    new Request('http://127.0.0.1/api/v1/metrics'),
    createEnv(envOverrides)
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function loadWorker() {
  const module = await import('../../worker/src/index.ts');
  return module.default;
}

describe('worker /api/v2 proxy resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('retries transient upstream failures for non-event sync routes', async () => {
    const worker = await loadWorker();
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
    const worker = await loadWorker();
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
    expect(payload.error.cause).toBe('upstream_5xx');
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry events ticket path by default', async () => {
    const worker = await loadWorker();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream down', { status: 503 }));

    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/events/ticket', { method: 'POST' }),
      createEnv({
        VPS_PROXY_RETRIES: '3',
      })
    );

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const diagnostics = await readDiagnosticsMetrics(worker);
    expect(diagnostics.metrics.vpsProxyNoRetryPathHits).toBeGreaterThan(0);
  });

  it('supports configurable no-retry proxy paths', async () => {
    const worker = await loadWorker();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('upstream down', { status: 503 }));

    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/sync/pull?cursor=22'),
      createEnv({
        VPS_PROXY_RETRIES: '3',
        VPS_PROXY_NO_RETRY_PATHS: '/api/v2/sync/pull,/api/v2/events',
      })
    );

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates upstream Retry-After for synthesized proxy outage responses', async () => {
    const worker = await loadWorker();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream down', {
        status: 503,
        headers: {
          'Retry-After': '17',
        },
      })
    );

    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/sync/pull?cursor=31'),
      createEnv({
        VPS_PROXY_RETRIES: '0',
      })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('17');
  });

  it('maps repeated timeout failures to structured SERVICE_UNAVAILABLE', async () => {
    const worker = await loadWorker();
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
    expect(payload.error.cause).toBe('timeout');
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast with origin_unconfigured cause when VPS_API_ORIGIN is missing', async () => {
    const worker = await loadWorker();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request('https://worker.example/api/v2/sync/pull?cursor=0'),
      createEnv({
        VPS_API_ORIGIN: '',
      })
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(payload.error.cause).toBe('origin_unconfigured');
    expect(payload.error.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a 32-character encryption secret when NODE_ENV is unset', async () => {
    const worker = await loadWorker();
    const before = await readDiagnosticsMetrics(worker);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gemini',
          apiKey: 'test-key',
        }),
      }),
      createEnv({
        KEY_ENCRYPTION_SECRET: '0123456789abcdef',
        NODE_ENV: '',
      })
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();

    const after = await readDiagnosticsMetrics(worker);
    expect(after.reliability.runtimeConfig.invalidEncryptionSecret).toBeGreaterThan(
      before.reliability.runtimeConfig.invalidEncryptionSecret
    );
  });

  it('tracks missing Clerk config failures when bearer auth is attempted', async () => {
    const worker = await loadWorker();
    const before = await readDiagnosticsMetrics(worker);
    const fakeToken = 'header.payload.signature';

    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      }),
      createEnv({
        ALLOW_INSECURE_DEV_AUTH: 'false',
        CLERK_JWKS_URL: '',
        CLERK_ISSUER: '',
        CLERK_AUDIENCE: '',
      })
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error.code).toBe('AUTH_CONFIG_INVALID');

    const after = await readDiagnosticsMetrics(worker);
    expect(after.reliability.authConfig.missingClerkConfig).toBeGreaterThan(
      before.reliability.authConfig.missingClerkConfig
    );
  });

  it('exposes per-cause upstream/provider counters in diagnostics metrics', async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request('http://127.0.0.1/api/v1/metrics'),
      createEnv()
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.failureCauses?.upstream).toMatchObject({
      origin_unconfigured: expect.any(Number),
      timeout: expect.any(Number),
      network_error: expect.any(Number),
      upstream_5xx: expect.any(Number),
      circuit_open: expect.any(Number),
      kv_unavailable: expect.any(Number),
    });
    expect(payload.failureCauses?.provider).toMatchObject({
      provider_timeout: expect.any(Number),
      provider_5xx: expect.any(Number),
      provider_circuit_open: expect.any(Number),
      provider_network_error: expect.any(Number),
    });
    expect(payload.reliability?.authConfig).toMatchObject({
      missingClerkConfig: expect.any(Number),
      partialClerkConfig: expect.any(Number),
      invalidClerkConfig: expect.any(Number),
    });
    expect(payload.reliability?.runtimeConfig).toMatchObject({
      invalidEncryptionSecret: expect.any(Number),
      invalidRotationSecret: expect.any(Number),
    });
    expect(payload.reliability?.secretRotation).toMatchObject({
      fallbackDecrypts: expect.any(Number),
      decryptFailures: expect.any(Number),
      reencryptSuccesses: expect.any(Number),
      reencryptFailures: expect.any(Number),
    });
    expect(payload.reliability?.kvFailures).toEqual(expect.any(Number));
  });

  it('opens a short VPS proxy circuit after repeated failures and then fails fast', async () => {
    const worker = await loadWorker();
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
    expect(payload.error.cause).toBe('circuit_open');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeOpenReject);
  });
});
