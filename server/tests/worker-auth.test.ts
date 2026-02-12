import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index.ts';

interface MockKvNamespace {
  get: (key: string, type: 'text' | 'json') => Promise<any>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const raw = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return raw
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createJwt(args: {
  privateKey: CryptoKey;
  kid: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: args.kid,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(args.payload));
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', args.privateKey, signed);
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function generateSigningMaterial(kid = 'kid-main'): Promise<{
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    jwk: {
      ...jwk,
      kid,
      alg: 'RS256',
      use: 'sig',
    },
  };
}

function createEnv(overrides: Partial<Record<string, string>> = {}) {
  const store = new Map<string, string>();
  const kv: MockKvNamespace = {
    async get(key, type) {
      const value = store.get(key);
      if (!value) return null;
      if (type === 'json') return JSON.parse(value);
      return value;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };

  return {
    AI_SESSIONS: kv,
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
    DEFAULT_MODEL: 'google/gemini-2.5-flash',
    VPS_API_ORIGIN: 'http://127.0.0.1:8788',
    CLERK_JWKS_URL: '',
    CLERK_ISSUER: '',
    CLERK_AUDIENCE: '',
    ALLOW_INSECURE_DEV_AUTH: 'false',
    ...overrides,
  } as any;
}

interface FetchRoute {
  method?: string;
  url: string | RegExp;
  assertHeaders?: Record<string, string>;
  handler: (args: { url: string; method: string; headers: Headers }) => Response | Promise<Response>;
}

function resolveFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): { url: string; method: string; headers: Headers } {
  const inputRequest = input instanceof Request ? input : null;
  const url = inputRequest ? inputRequest.url : String(input);
  const method = (init?.method || inputRequest?.method || 'GET').toUpperCase();
  const headers = new Headers(inputRequest?.headers || {});
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return { url, method, headers };
}

function mockFetchRoutes(routes: FetchRoute[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = resolveFetchRequest(input, init);
    const route = routes.find(candidate => {
      const methodMatches = !candidate.method || candidate.method.toUpperCase() === request.method;
      const urlMatches =
        typeof candidate.url === 'string' ? candidate.url === request.url : candidate.url.test(request.url);
      return methodMatches && urlMatches;
    });

    if (!route) {
      throw new Error(`Unexpected fetch target: ${request.method} ${request.url}`);
    }

    if (route.assertHeaders) {
      for (const [header, expected] of Object.entries(route.assertHeaders)) {
        const actual = request.headers.get(header);
        if (actual !== expected) {
          throw new Error(`Unexpected header ${header}: expected "${expected}", got "${actual}"`);
        }
      }
    }

    return route.handler(request);
  });
}

describe('worker jwt auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts valid RS256 token against Clerk JWKS and resolves account scope', async () => {
    const { privateKey, jwk } = await generateSigningMaterial('kid-valid');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await createJwt({
      privateKey,
      kid: 'kid-valid',
      payload: {
        sub: 'user_valid_1',
        iss: 'https://clerk.example.dev',
        aud: 'pocketbrain',
        iat: nowSeconds,
        exp: nowSeconds + 300,
      },
    });

    const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
    const fetchMock = mockFetchRoutes([
      {
        method: 'GET',
        url: jwksUrl,
        assertHeaders: {
          accept: 'application/json',
          'cache-control': 'no-cache',
        },
        handler: async () =>
          new Response(JSON.stringify({ keys: [jwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    ]);

    const env = createEnv({
      CLERK_JWKS_URL: jwksUrl,
      CLERK_ISSUER: 'https://clerk.example.dev',
      CLERK_AUDIENCE: 'pocketbrain',
      ALLOW_INSECURE_DEV_AUTH: 'false',
    });

    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      scope: 'account',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns config error when bearer token is present but Clerk vars are missing', async () => {
    const fakeToken = `${base64UrlEncode('{"alg":"none"}')}.${base64UrlEncode('{"sub":"user_1"}')}.sig`;
    const env = createEnv({
      CLERK_JWKS_URL: '',
      CLERK_ISSUER: '',
      CLERK_AUDIENCE: '',
      ALLOW_INSECURE_DEV_AUTH: 'false',
    });

    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      }),
      env
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error.code).toBe('AUTH_CONFIG_INVALID');
  });

  it('returns device scope when audience validation fails and insecure auth is disabled', async () => {
    const { privateKey, jwk } = await generateSigningMaterial('kid-aud');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await createJwt({
      privateKey,
      kid: 'kid-aud',
      payload: {
        sub: 'user_aud_mismatch',
        iss: 'https://clerk.example.dev',
        aud: 'wrong-audience',
        iat: nowSeconds,
        exp: nowSeconds + 300,
      },
    });

    const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
    mockFetchRoutes([
      {
        method: 'GET',
        url: jwksUrl,
        handler: async () =>
          new Response(JSON.stringify({ keys: [jwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    ]);

    const env = createEnv({
      CLERK_JWKS_URL: jwksUrl,
      CLERK_ISSUER: 'https://clerk.example.dev',
      CLERK_AUDIENCE: 'pocketbrain',
      ALLOW_INSECURE_DEV_AUTH: 'false',
    });

    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      scope: 'device',
    });
  });

  it('returns device scope when issuer validation fails and insecure auth is disabled', async () => {
    const { privateKey, jwk } = await generateSigningMaterial('kid-iss');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await createJwt({
      privateKey,
      kid: 'kid-iss',
      payload: {
        sub: 'user_issuer_mismatch',
        iss: 'https://wrong-issuer.example.dev',
        aud: 'pocketbrain',
        iat: nowSeconds,
        exp: nowSeconds + 300,
      },
    });

    const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
    mockFetchRoutes([
      {
        method: 'GET',
        url: jwksUrl,
        handler: async () =>
          new Response(JSON.stringify({ keys: [jwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    ]);

    const env = createEnv({
      CLERK_JWKS_URL: jwksUrl,
      CLERK_ISSUER: 'https://clerk.example.dev',
      CLERK_AUDIENCE: 'pocketbrain',
      ALLOW_INSECURE_DEV_AUTH: 'false',
    });

    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      scope: 'device',
    });
  });

  it('returns device scope when JWKS fetch fails and insecure auth is disabled', async () => {
    const fakeToken = `${base64UrlEncode('{"alg":"RS256","kid":"kid-jwks-fail"}')}.${base64UrlEncode('{"sub":"user_fail"}')}.sig`;
    const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
    mockFetchRoutes([
      {
        method: 'GET',
        url: jwksUrl,
        handler: async () => new Response(JSON.stringify({ error: 'jwks unavailable' }), { status: 503 }),
      },
    ]);

    const env = createEnv({
      CLERK_JWKS_URL: jwksUrl,
      CLERK_ISSUER: 'https://clerk.example.dev',
      CLERK_AUDIENCE: 'pocketbrain',
      ALLOW_INSECURE_DEV_AUTH: 'false',
    });

    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      scope: 'device',
    });
  });

  it('allows insecure decode fallback only on loopback when explicitly enabled', async () => {
    const fakeToken = `${base64UrlEncode('{"alg":"none"}')}.${base64UrlEncode('{"sub":"dev_user"}')}.sig`;
    const env = createEnv({
      ALLOW_INSECURE_DEV_AUTH: 'true',
      CLERK_JWKS_URL: '',
      CLERK_ISSUER: '',
      CLERK_AUDIENCE: '',
    });

    const localResponse = await worker.fetch(
      new Request('http://localhost/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      }),
      env
    );
    expect(localResponse.status).toBe(200);
    expect(await localResponse.json()).toEqual({
      connected: false,
      scope: 'account',
    });

    const nonLocalResponse = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      }),
      env
    );
    expect(nonLocalResponse.status).toBe(500);
    const nonLocalPayload = await nonLocalResponse.json();
    expect(nonLocalPayload.error.code).toBe('AUTH_CONFIG_INVALID');
  });

  it('uses cached JWKS on repeated verification calls', async () => {
    const { privateKey, jwk } = await generateSigningMaterial('kid-cache');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await createJwt({
      privateKey,
      kid: 'kid-cache',
      payload: {
        sub: 'user_cache',
        iss: 'https://clerk.example.dev',
        aud: 'pocketbrain',
        iat: nowSeconds,
        exp: nowSeconds + 300,
      },
    });

    const jwksUrl = `https://jwks.example/${crypto.randomUUID()}`;
    const fetchMock = mockFetchRoutes([
      {
        method: 'GET',
        url: jwksUrl,
        handler: async () =>
          new Response(JSON.stringify({ keys: [jwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    ]);

    const env = createEnv({
      CLERK_JWKS_URL: jwksUrl,
      CLERK_ISSUER: 'https://clerk.example.dev',
      CLERK_AUDIENCE: 'pocketbrain',
      ALLOW_INSECURE_DEV_AUTH: 'false',
    });

    const first = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env
    );
    const second = await worker.fetch(
      new Request('https://worker.example/api/v1/auth/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
