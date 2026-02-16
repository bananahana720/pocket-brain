import { afterEach, describe, expect, it, vi } from 'vitest';

type ControlPlaneMode = 'ok' | 'throw';

function createGeminiOkResponse(text = 'OK'): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function createEnv(options?: {
  controlPlaneMode?: ControlPlaneMode;
  overrides?: Partial<Record<string, string>>;
  store?: Map<string, string>;
}) {
  const mode = options?.controlPlaneMode ?? 'ok';
  const store = options?.store ?? new Map<string, string>();

  const controlPlane = {
    idFromName() {
      return {} as any;
    },
    get() {
      return {
        async fetch(input: string) {
          if (mode === 'throw') {
            throw new Error('control-plane unavailable');
          }

          const path = new URL(input).pathname;
          if (path === '/rate/check') {
            return new Response(JSON.stringify({ blocked: false, blockedUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (path === '/circuit/check') {
            return new Response(JSON.stringify({ open: false, openUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (path === '/circuit/failure') {
            return new Response(JSON.stringify({ opened: false, openUntil: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (path === '/circuit/success') {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      } as any;
    },
  };

  return {
    AI_SESSIONS: {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
      async delete(key: string) {
        store.delete(key);
      },
    },
    CONTROL_PLANE_DO: controlPlane,
    KEY_ENCRYPTION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ALLOW_INSECURE_DEV_AUTH: 'true',
    ...options?.overrides,
  } as any;
}

async function loadWorker() {
  const module = await import('../../worker/src/index.ts');
  return module.default;
}

async function connectLegacySession(worker: Awaited<ReturnType<typeof loadWorker>>, env: any): Promise<string> {
  const response = await worker.fetch(
    new Request('https://worker.example/api/v1/auth/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'gemini',
        apiKey: 'gemini-test-key',
      }),
    }),
    env
  );

  expect(response.status).toBe(200);
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return String(setCookie).split(';')[0];
}

async function callAiSearch(
  worker: Awaited<ReturnType<typeof loadWorker>>,
  env: any,
  cookie: string
): Promise<Response> {
  return worker.fetch(
    new Request('https://worker.example/api/v1/ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        query: 'what is due today?',
        notes: [],
      }),
    }),
    env
  );
}

describe('worker provider cause classification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns provider_timeout cause for timeout failures', async () => {
    const worker = await loadWorker();
    const env = createEnv();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createGeminiOkResponse('OK'))
      .mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));

    const cookie = await connectLegacySession(worker, env);
    const response = await callAiSearch(worker, env, cookie);
    const payload = await response.json();

    expect(response.status).toBe(504);
    expect(payload.error.code).toBe('TIMEOUT');
    expect(payload.error.retryable).toBe(true);
    expect(payload.error.cause).toBe('provider_timeout');
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('returns provider_network_error cause for provider network failures', async () => {
    const worker = await loadWorker();
    const env = createEnv();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createGeminiOkResponse('OK'))
      .mockRejectedValue(new TypeError('Network failed'));

    const cookie = await connectLegacySession(worker, env);
    const response = await callAiSearch(worker, env, cookie);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('NETWORK');
    expect(payload.error.retryable).toBe(true);
    expect(payload.error.cause).toBe('provider_network_error');
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('returns provider_5xx cause for upstream 5xx failures', async () => {
    const worker = await loadWorker();
    const env = createEnv();

    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return createGeminiOkResponse('OK');
      }
      return new Response('provider unavailable', { status: 503 });
    });

    const cookie = await connectLegacySession(worker, env);
    const response = await callAiSearch(worker, env, cookie);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(payload.error.retryable).toBe(true);
    expect(payload.error.cause).toBe('provider_5xx');
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('returns provider_circuit_open cause after repeated provider failures', async () => {
    const worker = await loadWorker();
    const env = createEnv({ controlPlaneMode: 'throw' });

    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('generativelanguage.googleapis.com')) {
        providerCalls += 1;
        if (providerCalls === 1) {
          return createGeminiOkResponse('OK');
        }
        return new Response('provider unavailable', { status: 503 });
      }
      throw new Error(`Unexpected fetch target in test: ${url}`);
    });

    const cookie = await connectLegacySession(worker, env);

    const firstFailure = await callAiSearch(worker, env, cookie);
    expect(firstFailure.status).toBe(503);

    const secondFailure = await callAiSearch(worker, env, cookie);
    const payload = await secondFailure.json();

    expect(secondFailure.status).toBe(503);
    expect(payload.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(payload.error.retryable).toBe(true);
    expect(payload.error.cause).toBe('provider_circuit_open');
    expect(Number(secondFailure.headers.get('retry-after') || '0')).toBeGreaterThan(0);
  });

  it('uses previous secret fallback during overlap and migrates to active secret', async () => {
    const worker = await loadWorker();
    const sharedStore = new Map<string, string>();
    const oldSecret = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const newSecret = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createGeminiOkResponse('OK'));

    const legacyEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: oldSecret,
      },
    });
    const cookie = await connectLegacySession(worker, legacyEnv);

    const overlapEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: newSecret,
        KEY_ENCRYPTION_SECRET_PREV: oldSecret,
      },
    });
    const overlapResponse = await callAiSearch(worker, overlapEnv, cookie);
    expect(overlapResponse.status).toBe(200);

    const activeOnlyEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: newSecret,
      },
    });
    const activeOnlyResponse = await callAiSearch(worker, activeOnlyEnv, cookie);
    expect(activeOnlyResponse.status).toBe(200);

    const metricsResponse = await worker.fetch(
      new Request('http://127.0.0.1/api/v1/metrics'),
      activeOnlyEnv
    );
    expect(metricsResponse.status).toBe(200);
    const metricsPayload = await metricsResponse.json();
    expect(metricsPayload.reliability.secretRotation.fallbackDecrypts).toBeGreaterThan(0);
    expect(metricsPayload.reliability.secretRotation.reencryptSuccesses).toBeGreaterThan(0);
  });

  it('tracks decrypt failures when neither active nor previous rotation secret can decrypt', async () => {
    const worker = await loadWorker();
    const sharedStore = new Map<string, string>();
    const originalSecret = 'cccccccccccccccccccccccccccccccc';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createGeminiOkResponse('OK'));

    const legacyEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: originalSecret,
      },
    });
    const cookie = await connectLegacySession(worker, legacyEnv);

    const invalidRotationEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: 'dddddddddddddddddddddddddddddddd',
        KEY_ENCRYPTION_SECRET_PREV: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
    });
    const response = await callAiSearch(worker, invalidRotationEnv, cookie);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe('AUTH_EXPIRED');

    const metricsResponse = await worker.fetch(
      new Request('http://127.0.0.1/api/v1/metrics'),
      invalidRotationEnv
    );
    expect(metricsResponse.status).toBe(200);
    const metricsPayload = await metricsResponse.json();
    expect(metricsPayload.reliability.secretRotation.decryptFailures).toBeGreaterThan(0);
  });

  it('ignores invalid previous rotation secret and tracks runtime metric', async () => {
    const worker = await loadWorker();
    const sharedStore = new Map<string, string>();
    const originalSecret = 'ffffffffffffffffffffffffffffffff';
    const newSecret = '11111111111111111111111111111111';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createGeminiOkResponse('OK'));

    const legacyEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: originalSecret,
      },
    });
    const cookie = await connectLegacySession(worker, legacyEnv);

    const runtimeEnv = createEnv({
      store: sharedStore,
      overrides: {
        KEY_ENCRYPTION_SECRET: newSecret,
        KEY_ENCRYPTION_SECRET_PREV: 'replace-with-32-byte-secret',
      },
    });

    const beforeMetrics = await worker.fetch(
      new Request('http://127.0.0.1/api/v1/metrics'),
      runtimeEnv
    );
    expect(beforeMetrics.status).toBe(200);
    const beforePayload = await beforeMetrics.json();

    const response = await callAiSearch(worker, runtimeEnv, cookie);
    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload.error.code).toBe('AUTH_EXPIRED');

    const afterMetrics = await worker.fetch(
      new Request('http://127.0.0.1/api/v1/metrics'),
      runtimeEnv
    );
    expect(afterMetrics.status).toBe(200);
    const afterPayload = await afterMetrics.json();
    expect(afterPayload.reliability.runtimeConfig.invalidRotationSecret).toBeGreaterThan(
      beforePayload.reliability.runtimeConfig.invalidRotationSecret
    );
  });
});
