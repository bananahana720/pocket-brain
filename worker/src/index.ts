interface KVNamespace {
  get(key: string, type: 'text'): Promise<string | null>;
  get(key: string, type: 'json'): Promise<any>;
  put(
    key: string,
    value: string,
    options?: {
      expirationTtl?: number;
    }
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface Env {
  AI_SESSIONS: KVNamespace;
  CONTROL_PLANE_DO: DurableObjectNamespace;
  KEY_ENCRYPTION_SECRET: string;
  KEY_ENCRYPTION_SECRET_PREV?: string;
  NODE_ENV?: string;
  DEFAULT_MODEL?: string;
  VPS_API_ORIGIN?: string;
  CLERK_JWKS_URL?: string;
  CLERK_ISSUER?: string;
  CLERK_AUDIENCE?: string;
  ALLOW_INSECURE_DEV_AUTH?: string;
  VPS_PROXY_TIMEOUT_MS?: string;
  VPS_PROXY_RETRIES?: string;
  VPS_PROXY_CIRCUIT_FAILURE_THRESHOLD?: string;
  VPS_PROXY_CIRCUIT_OPEN_MS?: string;
  VPS_PROXY_NO_RETRY_PATHS?: string;
}

type AIProvider = 'gemini' | 'openrouter';
type CleanupMode = 'single' | 'batch';
type UpstreamFailureCause =
  | 'origin_unconfigured'
  | 'timeout'
  | 'network_error'
  | 'upstream_5xx'
  | 'circuit_open'
  | 'kv_unavailable';
type ProviderFailureCause = 'provider_timeout' | 'provider_5xx' | 'provider_circuit_open' | 'provider_network_error';
type FailureCause = UpstreamFailureCause | ProviderFailureCause;

type Note = {
  id: string;
  content: string;
  createdAt: number;
  title?: string;
  tags?: string[];
  type?: 'NOTE' | 'TASK' | 'IDEA';
  isProcessed?: boolean;
  isCompleted?: boolean;
  isArchived?: boolean;
  dueDate?: number;
  priority?: 'urgent' | 'normal' | 'low';
};

interface SessionRecord {
  provider: AIProvider;
  encryptedApiKey: string;
  createdAt: number;
  expiresAt: number;
}

interface AccountKeyRecord {
  provider: AIProvider;
  encryptedApiKey: string;
  createdAt: number;
  updatedAt: number;
}

interface Metrics {
  requests: number;
  authFailures: number;
  providerFailures: number;
  retries: number;
  timeouts: number;
  rateLimited: number;
  circuitOpens: number;
  vpsProxyFailures: number;
  vpsProxyTimeouts: number;
  vpsProxyRetries: number;
  vpsProxyCircuitOpens: number;
  vpsProxyCircuitRejects: number;
  vpsProxyNoRetryPathHits: number;
  vpsProxyRetryAfterHonored: number;
  vpsProxy5xxPassthrough: number;
}

interface AuthConfigFailureMetrics {
  missingClerkConfig: number;
  partialClerkConfig: number;
  invalidClerkConfig: number;
}

interface RuntimeConfigFailureMetrics {
  invalidEncryptionSecret: number;
  invalidRotationSecret: number;
}

interface SecretRotationMetrics {
  fallbackDecrypts: number;
  decryptFailures: number;
  reencryptSuccesses: number;
  reencryptFailures: number;
}

interface ReliabilityMetrics {
  authConfig: AuthConfigFailureMetrics;
  runtimeConfig: RuntimeConfigFailureMetrics;
  secretRotation: SecretRotationMetrics;
  kvFailures: number;
}

const SESSION_COOKIE_NAME = 'pb_ai_session';
const ACCOUNT_KEY_PREFIX = 'account:';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const RETRY_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 12000;
const PROVIDER_OUTAGE_RETRY_AFTER_SECONDS = 5;
const KV_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;
const MAX_TRANSCRIPTION_AUDIO_BASE64_CHARS = 6 * 1024 * 1024;
const MAX_NOTE_CONTENT_CHARS = 800;
const MAX_NOTE_TITLE_CHARS = 120;
const MAX_QUERY_CHARS = 400;
const MAX_SEARCH_CONTEXT_NOTES = 40;
const MAX_DAILY_CONTEXT_NOTES = 60;
const MAX_CONTENT_CHARS = 6000;
const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const RATE_LIMIT_BLOCK_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000;
const DEFAULT_VPS_PROXY_TIMEOUT_MS = 7_000;
const DEFAULT_VPS_PROXY_RETRIES = 1;
const DEFAULT_VPS_PROXY_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_VPS_PROXY_CIRCUIT_OPEN_MS = 20_000;
const DEFAULT_VPS_PROXY_NO_RETRY_PATHS = ['/api/v2/events', '/api/v2/events/ticket'];
const PRODUCTION_SECRET_PLACEHOLDERS = new Set([
  'replace-with-32-byte-secret',
  'replace-with-separate-stream-ticket-secret',
  '0123456789abcdef0123456789abcdef',
  'fedcba9876543210fedcba9876543210',
]);

type RateLimitEntry = {
  windowStart: number;
  count: number;
  blockedUntil: number;
};

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number;
};

type ControlPlaneRateCheckResponse = {
  blocked: boolean;
  blockedUntil: number;
};

type ControlPlaneCircuitCheckResponse = {
  open: boolean;
  openUntil: number;
};

type ControlPlaneCircuitFailureResponse = {
  opened: boolean;
  openUntil: number;
};

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
}

interface ClerkJwtVerificationConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

const metrics: Metrics = {
  requests: 0,
  authFailures: 0,
  providerFailures: 0,
  retries: 0,
  timeouts: 0,
  rateLimited: 0,
  circuitOpens: 0,
  vpsProxyFailures: 0,
  vpsProxyTimeouts: 0,
  vpsProxyRetries: 0,
  vpsProxyCircuitOpens: 0,
  vpsProxyCircuitRejects: 0,
  vpsProxyNoRetryPathHits: 0,
  vpsProxyRetryAfterHonored: 0,
  vpsProxy5xxPassthrough: 0,
};
const upstreamFailureCauses: Record<UpstreamFailureCause, number> = {
  origin_unconfigured: 0,
  timeout: 0,
  network_error: 0,
  upstream_5xx: 0,
  circuit_open: 0,
  kv_unavailable: 0,
};
const providerFailureCauses: Record<ProviderFailureCause, number> = {
  provider_timeout: 0,
  provider_5xx: 0,
  provider_circuit_open: 0,
  provider_network_error: 0,
};
const reliabilityMetrics: ReliabilityMetrics = {
  authConfig: {
    missingClerkConfig: 0,
    partialClerkConfig: 0,
    invalidClerkConfig: 0,
  },
  runtimeConfig: {
    invalidEncryptionSecret: 0,
    invalidRotationSecret: 0,
  },
  secretRotation: {
    fallbackDecrypts: 0,
    decryptFailures: 0,
    reencryptSuccesses: 0,
    reencryptFailures: 0,
  },
  kvFailures: 0,
};

const rateLimits = new Map<string, RateLimitEntry>();
const providerCircuit: Record<AIProvider, CircuitState> = {
  gemini: { consecutiveFailures: 0, openUntil: 0 },
  openrouter: { consecutiveFailures: 0, openUntil: 0 },
};
const vpsProxyCircuit: CircuitState = {
  consecutiveFailures: 0,
  openUntil: 0,
};
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, { expiresAt: number; keys: JsonWebKey[] }>();

class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  headers?: Record<string, string>;
  failureCause?: FailureCause;

  constructor(
    status: number,
    code: string,
    message: string,
    retryable = false,
    headers?: Record<string, string>,
    failureCause?: FailureCause
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.headers = headers;
    this.failureCause = failureCause;
  }
}

function getEncryptionSecretMinLength(env: Env): number {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return 16;
  }
  return 32;
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (PRODUCTION_SECRET_PLACEHOLDERS.has(normalized)) return true;
  return (
    normalized.includes('replace-with') ||
    normalized.includes('your-') ||
    normalized.includes('example')
  );
}

function isUpstreamFailureCause(value: unknown): value is UpstreamFailureCause {
  return (
    value === 'origin_unconfigured' ||
    value === 'timeout' ||
    value === 'network_error' ||
    value === 'upstream_5xx' ||
    value === 'circuit_open' ||
    value === 'kv_unavailable'
  );
}

function isProviderFailureCause(value: unknown): value is ProviderFailureCause {
  return (
    value === 'provider_timeout' ||
    value === 'provider_5xx' ||
    value === 'provider_circuit_open' ||
    value === 'provider_network_error'
  );
}

function recordFailureCause(cause: FailureCause | undefined): void {
  if (!cause) return;
  if (isUpstreamFailureCause(cause)) {
    upstreamFailureCauses[cause] += 1;
    return;
  }
  if (isProviderFailureCause(cause)) {
    providerFailureCauses[cause] += 1;
  }
}

function getRetryAfterHeaders(retryAfterSeconds: number): Record<string, string> {
  return {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  };
}

function getRetryAfterSecondsFromHeaderValue(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1, Math.ceil(seconds));
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return Math.max(1, Math.ceil(deltaMs / 1000));
  }

  return null;
}

function getRetryAfterHeadersFromHeaderValue(
  retryAfterHeader: string | null,
  fallbackRetryAfterSeconds: number
): Record<string, string> {
  const parsedSeconds = getRetryAfterSecondsFromHeaderValue(retryAfterHeader);
  if (parsedSeconds !== null) {
    return getRetryAfterHeaders(parsedSeconds);
  }
  return getRetryAfterHeaders(fallbackRetryAfterSeconds);
}

function getVpsProxyUnavailableHeaders(retryAfterSeconds: number): Record<string, string> {
  return getRetryAfterHeaders(retryAfterSeconds);
}

function getProviderOutageHeaders(retryAfterHeader?: string | null): Record<string, string> {
  return getRetryAfterHeadersFromHeaderValue(retryAfterHeader ?? null, PROVIDER_OUTAGE_RETRY_AFTER_SECONDS);
}

function classifyProviderOutage(status: number, retryAfterHeader?: string | null): {
  failureCause?: ProviderFailureCause;
  headers?: Record<string, string>;
} {
  if (status >= 500) {
    return {
      failureCause: 'provider_5xx',
      headers: getProviderOutageHeaders(retryAfterHeader),
    };
  }
  return {};
}

function getValidatedVpsApiOrigin(env: Env): string {
  const origin = (env.VPS_API_ORIGIN || '').trim();
  if (!origin) {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'VPS API origin is not configured', false, undefined, 'origin_unconfigured');
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'VPS API origin is invalid. Use an absolute URL.',
      false,
      undefined,
      'origin_unconfigured'
    );
  }

  if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'VPS API origin must use https:// outside loopback hosts.',
      false,
      undefined,
      'origin_unconfigured'
    );
  }

  return origin;
}

function doJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function parseDoBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid JSON body');
  }
}

export class ControlPlaneDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      }

      const url = new URL(request.url);
      const body = await parseDoBody(request);

      if (url.pathname === '/rate/check') {
        const now = typeof body.now === 'number' ? body.now : Date.now();
        const windowMs = typeof body.windowMs === 'number' ? Math.max(1, body.windowMs) : RATE_LIMIT_WINDOW_MS;
        const maxRequests = typeof body.maxRequests === 'number' ? Math.max(1, body.maxRequests) : RATE_LIMIT_MAX_REQUESTS;
        const blockMs = typeof body.blockMs === 'number' ? Math.max(1, body.blockMs) : RATE_LIMIT_BLOCK_MS;

        let entry = (await this.state.storage.get<RateLimitEntry>('rate')) || {
          windowStart: now,
          count: 0,
          blockedUntil: 0,
        };

        if (now - entry.windowStart >= windowMs) {
          entry = { windowStart: now, count: 0, blockedUntil: 0 };
        }

        if (entry.blockedUntil > now) {
          await this.state.storage.put('rate', entry);
          return doJson({ blocked: true, blockedUntil: entry.blockedUntil } satisfies ControlPlaneRateCheckResponse);
        }

        entry.count += 1;
        if (entry.count > maxRequests) {
          entry.blockedUntil = now + blockMs;
          await this.state.storage.put('rate', entry);
          return doJson({ blocked: true, blockedUntil: entry.blockedUntil } satisfies ControlPlaneRateCheckResponse);
        }

        await this.state.storage.put('rate', entry);
        return doJson({ blocked: false, blockedUntil: entry.blockedUntil } satisfies ControlPlaneRateCheckResponse);
      }

      if (url.pathname === '/circuit/check') {
        const now = typeof body.now === 'number' ? body.now : Date.now();
        const entry = (await this.state.storage.get<CircuitState>('circuit')) || {
          consecutiveFailures: 0,
          openUntil: 0,
        };
        return doJson({ open: entry.openUntil > now, openUntil: entry.openUntil } satisfies ControlPlaneCircuitCheckResponse);
      }

      if (url.pathname === '/circuit/success') {
        const entry = (await this.state.storage.get<CircuitState>('circuit')) || {
          consecutiveFailures: 0,
          openUntil: 0,
        };
        if (entry.consecutiveFailures !== 0) {
          entry.consecutiveFailures = 0;
          await this.state.storage.put('circuit', entry);
        }
        return doJson({ ok: true });
      }

      if (url.pathname === '/circuit/failure') {
        const now = typeof body.now === 'number' ? body.now : Date.now();
        const threshold =
          typeof body.failureThreshold === 'number' ? Math.max(1, body.failureThreshold) : CIRCUIT_FAILURE_THRESHOLD;
        const openMs = typeof body.openMs === 'number' ? Math.max(1, body.openMs) : CIRCUIT_OPEN_MS;
        const entry = (await this.state.storage.get<CircuitState>('circuit')) || {
          consecutiveFailures: 0,
          openUntil: 0,
        };

        if (entry.openUntil > now) {
          return doJson({ opened: false, openUntil: entry.openUntil } satisfies ControlPlaneCircuitFailureResponse);
        }

        entry.consecutiveFailures += 1;
        let opened = false;
        if (entry.consecutiveFailures >= threshold) {
          entry.consecutiveFailures = 0;
          entry.openUntil = now + openMs;
          opened = true;
        }

        await this.state.storage.put('circuit', entry);
        return doJson({ opened, openUntil: entry.openUntil } satisfies ControlPlaneCircuitFailureResponse);
      }

      throw new ApiError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      if (error instanceof ApiError) {
        return doJson(
          {
            error: {
              code: error.code,
              message: error.message,
            },
          },
          error.status
        );
      }

      return doJson(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
        },
        500
      );
    }
  }
}

function jsonResponse(
  payload: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      metrics.authFailures += 1;
    }
    if (error.status >= 500) {
      metrics.providerFailures += 1;
    }
    recordFailureCause(error.failureCause);
    const payload = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.failureCause ? { cause: error.failureCause } : {}),
    };
    return jsonResponse(
      {
        error: payload,
      },
      error.status,
      error.headers
    );
  }

  return jsonResponse(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        retryable: false,
      },
    },
    500
  );
}

function parseBoundedEnvNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseNoRetryPaths(value: string | undefined): Set<string> {
  const parsed = String(value || '')
    .split(',')
    .map(path => path.trim())
    .filter(Boolean)
    .map(path => (path.startsWith('/') ? path : `/${path}`));
  const values = parsed.length > 0 ? parsed : DEFAULT_VPS_PROXY_NO_RETRY_PATHS;
  return new Set(values);
}

function recordVpsProxyFailure(circuitFailureThreshold: number, circuitOpenMs: number): number {
  metrics.vpsProxyFailures += 1;
  vpsProxyCircuit.consecutiveFailures += 1;
  if (vpsProxyCircuit.consecutiveFailures >= circuitFailureThreshold) {
    vpsProxyCircuit.consecutiveFailures = 0;
    vpsProxyCircuit.openUntil = Date.now() + circuitOpenMs;
    metrics.vpsProxyCircuitOpens += 1;
  }
  return Math.max(1, Math.ceil(circuitOpenMs / 1000));
}

async function proxyToVps(request: Request, env: Env, pathname: string): Promise<Response> {
  if (vpsProxyCircuit.openUntil > Date.now()) {
    metrics.vpsProxyCircuitRejects += 1;
    metrics.vpsProxyFailures += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((vpsProxyCircuit.openUntil - Date.now()) / 1000));
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'Sync service is temporarily unavailable. Please retry shortly.',
      true,
      getVpsProxyUnavailableHeaders(retryAfterSeconds),
      'circuit_open'
    );
  }

  let origin = '';
  try {
    origin = getValidatedVpsApiOrigin(env);
  } catch (error) {
    if (error instanceof ApiError && error.failureCause === 'origin_unconfigured') {
      metrics.vpsProxyFailures += 1;
    }
    throw error;
  }

  const timeoutMs = parseBoundedEnvNumber(env.VPS_PROXY_TIMEOUT_MS, DEFAULT_VPS_PROXY_TIMEOUT_MS, 1_000, 30_000);
  const retries = parseBoundedEnvNumber(env.VPS_PROXY_RETRIES, DEFAULT_VPS_PROXY_RETRIES, 0, 5);
  const circuitFailureThreshold = parseBoundedEnvNumber(
    env.VPS_PROXY_CIRCUIT_FAILURE_THRESHOLD,
    DEFAULT_VPS_PROXY_CIRCUIT_FAILURE_THRESHOLD,
    1,
    20
  );
  const circuitOpenMs = parseBoundedEnvNumber(env.VPS_PROXY_CIRCUIT_OPEN_MS, DEFAULT_VPS_PROXY_CIRCUIT_OPEN_MS, 1_000, 120_000);
  const noRetryPaths = parseNoRetryPaths(env.VPS_PROXY_NO_RETRY_PATHS);
  const shouldRetry = !noRetryPaths.has(pathname);
  if (!shouldRetry) {
    metrics.vpsProxyNoRetryPathHits += 1;
  }

  const url = new URL(request.url);
  const target = new URL(`${origin}${pathname}${url.search}`);

  const headers = new Headers();
  const forwardHeader = (name: string) => {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  };

  forwardHeader('authorization');
  forwardHeader('x-request-id');
  forwardHeader('x-device-id');
  forwardHeader('content-type');
  forwardHeader('accept');
  forwardHeader('cache-control');

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const bodyBuffer = hasBody ? await request.arrayBuffer() : null;

  const attempts = shouldRetry ? retries + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { signal, cleanup } = timeoutSignal(timeoutMs);
    const init: RequestInit = {
      method,
      headers,
      signal,
      body: hasBody ? bodyBuffer?.slice(0) : undefined,
    };

    try {
      const response = await fetch(target.toString(), init);

      if (response.status >= 500) {
        if (attempt < attempts - 1) {
          metrics.vpsProxyRetries += 1;
          await wait(Math.min(1200, 180 * Math.pow(2, attempt)) + Math.floor(Math.random() * 80));
          continue;
        }

        const retryAfterSeconds = recordVpsProxyFailure(circuitFailureThreshold, circuitOpenMs);
        const upstreamRetryAfter = getRetryAfterSecondsFromHeaderValue(response.headers.get('retry-after'));
        if (upstreamRetryAfter !== null) {
          metrics.vpsProxyRetryAfterHonored += 1;
        }
        metrics.vpsProxy5xxPassthrough += 1;
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Sync service is temporarily unavailable. Please retry shortly.',
          true,
          upstreamRetryAfter !== null ? getRetryAfterHeaders(upstreamRetryAfter) : getRetryAfterHeaders(retryAfterSeconds),
          'upstream_5xx'
        );
      }

      const passthroughHeaders = new Headers(response.headers);
      if (vpsProxyCircuit.consecutiveFailures !== 0 || vpsProxyCircuit.openUntil !== 0) {
        vpsProxyCircuit.consecutiveFailures = 0;
        vpsProxyCircuit.openUntil = 0;
      }
      return new Response(response.body, {
        status: response.status,
        headers: passthroughHeaders,
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
      if (isTimeout) {
        metrics.vpsProxyTimeouts += 1;
      }

      if (error instanceof ApiError) {
        throw error;
      }

      if (attempt < attempts - 1) {
        metrics.vpsProxyRetries += 1;
        await wait(Math.min(1200, 180 * Math.pow(2, attempt)) + Math.floor(Math.random() * 80));
        continue;
      }

      const retryAfterSeconds = recordVpsProxyFailure(circuitFailureThreshold, circuitOpenMs);
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Sync service is temporarily unavailable. Please retry shortly.',
        true,
        getVpsProxyUnavailableHeaders(retryAfterSeconds),
        isTimeout ? 'timeout' : 'network_error'
      );
    } finally {
      cleanup();
    }
  }

  const retryAfterSeconds = recordVpsProxyFailure(circuitFailureThreshold, circuitOpenMs);
  throw new ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'Sync service is temporarily unavailable. Please retry shortly.',
    true,
    getVpsProxyUnavailableHeaders(retryAfterSeconds),
    'upstream_5xx'
  );
}

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies: Record<string, string> = {};

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function buildCookie(request: Request, value: string, maxAgeSeconds: number): string {
  const url = new URL(request.url);
  const secure = url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? '' : '; Secure';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly${secure}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

function clearCookie(request: Request): string {
  return buildCookie(request, '', 0);
}

function getSessionId(request: Request): string | null {
  const cookies = parseCookies(request);
  return cookies[SESSION_COOKIE_NAME] || null;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function base64UrlDecodeBytes(input: string): Uint8Array {
  const raw = base64UrlDecode(input);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

function parseJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

async function fetchJwks(url: string): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS (${response.status})`);
  }

  const payload = (await response.json()) as { keys?: JsonWebKey[] };
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  jwksCache.set(url, {
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
    keys,
  });

  return keys;
}

function audienceMatches(claim: string | string[] | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!claim) return false;
  if (typeof claim === 'string') return claim === expected;
  return claim.includes(expected);
}

function assertSecureAbsoluteUrlSetting(settingName: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    reliabilityMetrics.authConfig.invalidClerkConfig += 1;
    throw new ApiError(500, 'AUTH_CONFIG_INVALID', `${settingName} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
    reliabilityMetrics.authConfig.invalidClerkConfig += 1;
    throw new ApiError(
      500,
      'AUTH_CONFIG_INVALID',
      `${settingName} must use https:// outside loopback hosts.`
    );
  }
}

function getClerkJwtVerificationConfig(env: Env): ClerkJwtVerificationConfig | null {
  const jwksUrl = (env.CLERK_JWKS_URL || '').trim();
  const issuer = (env.CLERK_ISSUER || '').trim();
  const audience = (env.CLERK_AUDIENCE || '').trim();
  const definedCount = [jwksUrl, issuer, audience].filter(Boolean).length;

  if (definedCount === 0) return null;
  if (definedCount !== 3) {
    reliabilityMetrics.authConfig.partialClerkConfig += 1;
    throw new ApiError(
      500,
      'AUTH_CONFIG_INVALID',
      'CLERK_JWKS_URL, CLERK_ISSUER, and CLERK_AUDIENCE must be set together.'
    );
  }

  assertSecureAbsoluteUrlSetting('CLERK_JWKS_URL', jwksUrl);
  assertSecureAbsoluteUrlSetting('CLERK_ISSUER', issuer);

  return {
    jwksUrl,
    issuer,
    audience,
  };
}

function allowInsecureDevAuth(request: Request, env: Env): boolean {
  if (env.ALLOW_INSECURE_DEV_AUTH !== 'true') return false;
  try {
    const url = new URL(request.url);
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

async function verifyJwtClaimsAndSignature(
  token: string,
  config: ClerkJwtVerificationConfig
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0])) as JwtHeader;
    payload = JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const keys = await fetchJwks(config.jwksUrl);
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) return null;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecodeBytes(parts[2]);
  const signatureValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
  if (!signatureValid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp <= now - 30) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 30) return null;

  if (payload.iss !== config.issuer) return null;
  if (!audienceMatches(payload.aud, config.audience)) return null;

  return payload;
}

async function getAuthenticatedUserId(request: Request, env: Env): Promise<string | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  const clerkConfig = getClerkJwtVerificationConfig(env);
  const insecureFallbackEnabled = allowInsecureDevAuth(request, env);
  if (!clerkConfig && !insecureFallbackEnabled) {
    reliabilityMetrics.authConfig.missingClerkConfig += 1;
    throw new ApiError(
      500,
      'AUTH_CONFIG_INVALID',
      'Clerk auth verification is not configured. Set CLERK_JWKS_URL, CLERK_ISSUER, and CLERK_AUDIENCE.'
    );
  }

  try {
    const verifiedPayload = clerkConfig ? await verifyJwtClaimsAndSignature(token, clerkConfig) : null;
    if (verifiedPayload?.sub && verifiedPayload.sub.trim()) {
      return verifiedPayload.sub.trim();
    }
  } catch {
    // Continue to optional insecure dev fallback.
  }

  if (insecureFallbackEnabled) {
    const decodedPayload = parseJwtPayload(token);
    const sub = typeof decodedPayload?.sub === 'string' ? decodedPayload.sub.trim() : '';
    return sub || null;
  }

  return null;
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  if (!forwarded) return 'unknown';
  return forwarded.split(',')[0].trim() || 'unknown';
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isLocalDiagnosticsRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (isLoopbackHost(url.hostname)) return true;
  const ip = getClientIp(request);
  return ip === '127.0.0.1' || ip === '::1';
}

function requireJsonContentType(request: Request): void {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new ApiError(415, 'BAD_REQUEST', 'Content-Type must be application/json');
  }
}

function ensureEncryptionSecretConfigured(env: Env): void {
  const secret = typeof env.KEY_ENCRYPTION_SECRET === 'string' ? env.KEY_ENCRYPTION_SECRET.trim() : '';
  const minLength = getEncryptionSecretMinLength(env);
  if (!secret || secret.length < minLength) {
    reliabilityMetrics.runtimeConfig.invalidEncryptionSecret += 1;
    throw new ApiError(500, 'INTERNAL_ERROR', 'AI proxy encryption secret is not configured');
  }
}

function getValidatedPreviousEncryptionSecret(env: Env): string | null {
  const previousSecret = typeof env.KEY_ENCRYPTION_SECRET_PREV === 'string' ? env.KEY_ENCRYPTION_SECRET_PREV.trim() : '';
  if (!previousSecret) return null;

  const activeSecret = typeof env.KEY_ENCRYPTION_SECRET === 'string' ? env.KEY_ENCRYPTION_SECRET.trim() : '';
  const minLength = getEncryptionSecretMinLength(env);
  if (
    previousSecret.length < minLength ||
    isPlaceholderSecret(previousSecret) ||
    (activeSecret && previousSecret === activeSecret)
  ) {
    reliabilityMetrics.runtimeConfig.invalidRotationSecret += 1;
    return null;
  }

  return previousSecret;
}

function kvUnavailableError(): ApiError {
  return new ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'Session storage is temporarily unavailable. Please retry shortly.',
    true,
    getRetryAfterHeaders(KV_UNAVAILABLE_RETRY_AFTER_SECONDS),
    'kv_unavailable'
  );
}

async function kvGetText(env: Env, key: string): Promise<string | null> {
  try {
    return await env.AI_SESSIONS.get(key, 'text');
  } catch {
    reliabilityMetrics.kvFailures += 1;
    throw kvUnavailableError();
  }
}

async function kvPutText(
  env: Env,
  key: string,
  value: string,
  options?: {
    expirationTtl?: number;
  }
): Promise<void> {
  try {
    await env.AI_SESSIONS.put(key, value, options);
  } catch {
    reliabilityMetrics.kvFailures += 1;
    throw kvUnavailableError();
  }
}

async function kvDelete(env: Env, key: string): Promise<void> {
  try {
    await env.AI_SESSIONS.delete(key);
  } catch {
    reliabilityMetrics.kvFailures += 1;
    throw kvUnavailableError();
  }
}

function enforceRateLimitLocal(request: Request, identityKey?: string): void {
  const now = Date.now();
  const key = `${identityKey || 'anon'}:${getClientIp(request)}`;

  if (rateLimits.size > 5000) {
    for (const [entryKey, entry] of rateLimits.entries()) {
      if (entry.blockedUntil < now - RATE_LIMIT_WINDOW_MS && now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimits.delete(entryKey);
      }
    }
  }

  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry = {
      windowStart: now,
      count: 0,
      blockedUntil: 0,
    };
  }

  if (entry.blockedUntil > now) {
    metrics.rateLimited += 1;
    rateLimits.set(key, entry);
    throw new ApiError(429, 'RATE_LIMITED', 'Too many AI requests. Please retry in a minute.', true);
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    entry.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
    metrics.rateLimited += 1;
    rateLimits.set(key, entry);
    throw new ApiError(429, 'RATE_LIMITED', 'Too many AI requests. Please retry in a minute.', true);
  }

  rateLimits.set(key, entry);
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ApiError && error.retryable && (error.status === 429 || error.status >= 500);
}

function ensureCircuitClosedLocal(provider: AIProvider): void {
  const state = providerCircuit[provider];
  if (state.openUntil > Date.now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.openUntil - Date.now()) / 1000));
    throw new ApiError(
      503,
      'PROVIDER_UNAVAILABLE',
      'Provider is temporarily unavailable. Please retry shortly.',
      true,
      getRetryAfterHeaders(retryAfterSeconds),
      'provider_circuit_open'
    );
  }
}

function recordProviderSuccessLocal(provider: AIProvider): void {
  providerCircuit[provider].consecutiveFailures = 0;
}

function recordProviderFailureLocal(provider: AIProvider, error: unknown): void {
  if (!isRetryableProviderError(error)) return;

  const state = providerCircuit[provider];
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.consecutiveFailures = 0;
    state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    metrics.circuitOpens += 1;
  }
}

async function callControlPlane<T>(env: Env, name: string, path: string, body: Record<string, unknown>): Promise<T> {
  const id = env.CONTROL_PLANE_DO.idFromName(name);
  const stub = env.CONTROL_PLANE_DO.get(id);
  const response = await stub.fetch(`https://control-plane${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Control plane request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

async function enforceRateLimit(request: Request, env: Env, identityKey?: string): Promise<void> {
  const key = `${identityKey || 'anon'}:${getClientIp(request)}`;
  try {
    const result = await callControlPlane<ControlPlaneRateCheckResponse>(env, `rate:${key}`, '/rate/check', {
      now: Date.now(),
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      blockMs: RATE_LIMIT_BLOCK_MS,
    });
    if (result.blocked) {
      metrics.rateLimited += 1;
      throw new ApiError(429, 'RATE_LIMITED', 'Too many AI requests. Please retry in a minute.', true);
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
      throw error;
    }
    enforceRateLimitLocal(request, identityKey);
  }
}

async function ensureCircuitClosed(provider: AIProvider, env: Env): Promise<void> {
  try {
    const result = await callControlPlane<ControlPlaneCircuitCheckResponse>(
      env,
      `circuit:${provider}`,
      '/circuit/check',
      { now: Date.now() }
    );
    if (result.open) {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.openUntil - Date.now()) / 1000));
      throw new ApiError(
        503,
        'PROVIDER_UNAVAILABLE',
        'Provider is temporarily unavailable. Please retry shortly.',
        true,
        getRetryAfterHeaders(retryAfterSeconds),
        'provider_circuit_open'
      );
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PROVIDER_UNAVAILABLE') {
      throw error;
    }
    ensureCircuitClosedLocal(provider);
  }
}

async function recordProviderSuccess(provider: AIProvider, env: Env): Promise<void> {
  try {
    await callControlPlane(env, `circuit:${provider}`, '/circuit/success', { now: Date.now() });
  } catch {
    recordProviderSuccessLocal(provider);
  }
}

async function recordProviderFailure(provider: AIProvider, error: unknown, env: Env): Promise<void> {
  if (!isRetryableProviderError(error)) return;

  try {
    const result = await callControlPlane<ControlPlaneCircuitFailureResponse>(
      env,
      `circuit:${provider}`,
      '/circuit/failure',
      {
        now: Date.now(),
        failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
        openMs: CIRCUIT_OPEN_MS,
      }
    );
    if (result.opened) {
      metrics.circuitOpens += 1;
    }
  } catch {
    recordProviderFailureLocal(provider, error);
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64Decode(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

async function getAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptApiKey(apiKey: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getAesKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    new TextEncoder().encode(apiKey)
  );

  return JSON.stringify({
    iv: base64Encode(iv),
    data: base64Encode(new Uint8Array(ciphertext)),
  });
}

async function decryptApiKey(payload: string, secret: string): Promise<string> {
  const parsed = JSON.parse(payload) as { iv: string; data: string };
  const iv = base64Decode(parsed.iv);
  const data = base64Decode(parsed.data);
  const key = await getAesKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  );

  return new TextDecoder().decode(plaintext);
}

async function decryptSessionApiKey(
  payload: string,
  env: Env
): Promise<{ apiKey: string; usedPreviousSecret: boolean }> {
  try {
    const apiKey = await decryptApiKey(payload, env.KEY_ENCRYPTION_SECRET);
    return { apiKey, usedPreviousSecret: false };
  } catch (error) {
    const previousSecret = getValidatedPreviousEncryptionSecret(env);
    if (!previousSecret) {
      reliabilityMetrics.secretRotation.decryptFailures += 1;
      throw error;
    }

    try {
      const apiKey = await decryptApiKey(payload, previousSecret);
      reliabilityMetrics.secretRotation.fallbackDecrypts += 1;
      return { apiKey, usedPreviousSecret: true };
    } catch (previousError) {
      reliabilityMetrics.secretRotation.decryptFailures += 1;
      throw previousError;
    }
  }
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

async function withRetries<T>(handler: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await handler();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ApiError && error.retryable;
      if (!retryable || attempt === RETRY_ATTEMPTS) {
        throw error;
      }
      metrics.retries += 1;
      await wait(Math.min(1500, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 120));
    }
  }

  throw lastError;
}

function parseProvider(body: any): AIProvider {
  if (body?.provider === 'gemini' || body?.provider === 'openrouter') return body.provider;
  throw new ApiError(400, 'BAD_REQUEST', 'Provider must be gemini or openrouter');
}

function parseCleanupMode(value: unknown): CleanupMode {
  if (value === 'single' || value === 'batch') return value;
  throw new ApiError(400, 'BAD_REQUEST', 'mode must be "single" or "batch"');
}

function parseTranscriptionRequest(body: any): { audioBase64: string; mimeType: string; language?: string } {
  const audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64.trim() : '';
  if (!audioBase64) {
    throw new ApiError(400, 'BAD_REQUEST', 'audioBase64 is required');
  }
  if (audioBase64.length > MAX_TRANSCRIPTION_AUDIO_BASE64_CHARS) {
    throw new ApiError(413, 'BAD_REQUEST', 'Audio payload is too large');
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(audioBase64)) {
    throw new ApiError(400, 'BAD_REQUEST', 'audioBase64 must be a valid base64 string');
  }

  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';
  if (!mimeType || !mimeType.startsWith('audio/')) {
    throw new ApiError(400, 'BAD_REQUEST', 'Unsupported audio mimeType');
  }

  const language = typeof body?.language === 'string' ? body.language.trim() : '';
  if (language && !/^[A-Za-z-]{2,10}$/.test(language)) {
    throw new ApiError(400, 'BAD_REQUEST', 'language must be an ISO language code');
  }

  return language ? { audioBase64, mimeType, language } : { audioBase64, mimeType };
}

function clampText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function parseContent(value: unknown, fieldName = 'content'): string {
  const content = typeof value === 'string' ? value.trim() : '';
  if (!content) {
    throw new ApiError(400, 'BAD_REQUEST', `${fieldName} is required`);
  }
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) : content;
}

function parseQuery(value: unknown): string {
  const query = typeof value === 'string' ? value.trim() : '';
  if (!query) {
    throw new ApiError(400, 'BAD_REQUEST', 'query is required');
  }
  return query.length > MAX_QUERY_CHARS ? query.slice(0, MAX_QUERY_CHARS) : query;
}

function parseNotesContext(value: unknown, limit: number): Note[] {
  if (!Array.isArray(value)) return [];

  const normalized: Note[] = [];
  for (const rawNote of value) {
    if (!rawNote || typeof rawNote !== 'object') continue;
    const note = rawNote as Record<string, unknown>;
    const content = typeof note.content === 'string' ? clampText(note.content, MAX_NOTE_CONTENT_CHARS) : '';
    if (!content) continue;

    const createdAt = typeof note.createdAt === 'number' && Number.isFinite(note.createdAt) ? note.createdAt : Date.now();
    const candidateType = note.type === 'TASK' || note.type === 'IDEA' || note.type === 'NOTE' ? note.type : undefined;
    const dueDate = typeof note.dueDate === 'number' && Number.isFinite(note.dueDate) ? note.dueDate : undefined;
    const priority = note.priority === 'urgent' || note.priority === 'normal' || note.priority === 'low' ? note.priority : undefined;

    normalized.push({
      id: typeof note.id === 'string' ? note.id : crypto.randomUUID(),
      content,
      createdAt,
      ...(typeof note.title === 'string' ? { title: clampText(note.title, MAX_NOTE_TITLE_CHARS) } : {}),
      ...(Array.isArray(note.tags)
        ? {
            tags: note.tags
              .map(tag => (typeof tag === 'string' ? clampText(tag, 24) : ''))
              .filter(Boolean)
              .slice(0, 6),
          }
        : {}),
      ...(candidateType ? { type: candidateType } : {}),
      ...(typeof note.isCompleted === 'boolean' ? { isCompleted: note.isCompleted } : {}),
      ...(typeof note.isArchived === 'boolean' ? { isArchived: note.isArchived } : {}),
      ...(typeof dueDate === 'number' ? { dueDate } : {}),
      ...(priority ? { priority } : {}),
    });

    if (normalized.length >= limit) break;
  }

  return normalized;
}

async function parseJson(request: Request): Promise<any> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError(413, 'BAD_REQUEST', 'Request body too large');
  }

  try {
    const raw = await request.text();
    if (!raw.trim()) return {};
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new ApiError(413, 'BAD_REQUEST', 'Request body too large');
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid JSON body');
  }
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const { signal, cleanup } = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
          },
        }),
        signal,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const outage = classifyProviderOutage(response.status, response.headers.get('retry-after'));
      throw new ApiError(
        response.status,
        response.status === 401 ? 'AUTH_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `Gemini request failed: ${body.slice(0, 200)}`,
        isTransientStatus(response.status),
        outage.headers,
        outage.failureCause
      );
    }

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== 'string') {
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Gemini returned no text output', true);
    }
    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      metrics.timeouts += 1;
      throw new ApiError(504, 'TIMEOUT', 'Provider request timed out', true, getProviderOutageHeaders(), 'provider_timeout');
    }
    throw new ApiError(
      503,
      'NETWORK',
      'Network error while contacting Gemini',
      true,
      getProviderOutageHeaders(),
      'provider_network_error'
    );
  } finally {
    cleanup();
  }
}

function buildTranscriptionPrompt(language?: string): string {
  const languageHint = language ? ` The spoken language is likely ${language}.` : '';
  return `Transcribe this audio accurately as plain text with punctuation.${languageHint}
Return only the transcript text with no extra commentary.
If no clear speech is detected, return an empty string.`;
}

async function callGeminiTranscription(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
  language?: string
): Promise<string> {
  const { signal, cleanup } = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: buildTranscriptionPrompt(language) },
                { inline_data: { mime_type: mimeType, data: audioBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
          },
        }),
        signal,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const outage = classifyProviderOutage(response.status, response.headers.get('retry-after'));
      throw new ApiError(
        response.status,
        response.status === 401 ? 'AUTH_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `Gemini transcription failed: ${body.slice(0, 200)}`,
        isTransientStatus(response.status),
        outage.headers,
        outage.failureCause
      );
    }

    const data = (await response.json()) as any;
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
          .map(part => (typeof part?.text === 'string' ? part.text : ''))
          .join('\n')
          .trim()
      : '';

    if (!text) {
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Gemini returned no transcript', true);
    }

    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      metrics.timeouts += 1;
      throw new ApiError(504, 'TIMEOUT', 'Provider request timed out', true, getProviderOutageHeaders(), 'provider_timeout');
    }
    throw new ApiError(
      503,
      'NETWORK',
      'Network error while contacting Gemini',
      true,
      getProviderOutageHeaders(),
      'provider_network_error'
    );
  } finally {
    cleanup();
  }
}

async function callOpenRouter(apiKey: string, prompt: string, model = 'google/gemini-2.5-flash'): Promise<string> {
  const { signal, cleanup } = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'PocketBrain',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text();
      const outage = classifyProviderOutage(response.status, response.headers.get('retry-after'));
      throw new ApiError(
        response.status,
        response.status === 401 ? 'AUTH_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `OpenRouter request failed: ${body.slice(0, 200)}`,
        isTransientStatus(response.status),
        outage.headers,
        outage.failureCause
      );
    }

    const data = (await response.json()) as any;
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') {
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'OpenRouter returned no text output', true);
    }

    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      metrics.timeouts += 1;
      throw new ApiError(504, 'TIMEOUT', 'Provider request timed out', true, getProviderOutageHeaders(), 'provider_timeout');
    }
    throw new ApiError(
      503,
      'NETWORK',
      'Network error while contacting OpenRouter',
      true,
      getProviderOutageHeaders(),
      'provider_network_error'
    );
  } finally {
    cleanup();
  }
}

async function callProvider(env: Env, provider: AIProvider, apiKey: string, prompt: string, model?: string): Promise<string> {
  await ensureCircuitClosed(provider, env);

  try {
    const result = provider === 'gemini' ? await callGemini(apiKey, prompt) : await callOpenRouter(apiKey, prompt, model);
    await recordProviderSuccess(provider, env);
    return result;
  } catch (error) {
    await recordProviderFailure(provider, error, env);
    throw error;
  }
}

function safeParseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    const firstObject = value.match(/\{[\s\S]*\}/);
    const firstArray = value.match(/\[[\s\S]*\]/);
    const candidate = firstObject?.[0] || firstArray?.[0];
    if (!candidate) {
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'AI provider returned invalid JSON', true);
    }
    try {
      return JSON.parse(candidate) as T;
    } catch {
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'AI provider returned invalid JSON', true);
    }
  }
}

async function validateApiKey(provider: AIProvider, apiKey: string, env: Env): Promise<void> {
  const prompt = 'Reply with exactly OK.';
  const text = await withRetries(() => callProvider(env, provider, apiKey, prompt));
  if (!text.toUpperCase().includes('OK')) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'API key validation failed');
  }
}

async function requireLegacySession(
  request: Request,
  env: Env
): Promise<{ sessionId: string; provider: AIProvider; apiKey: string; expiresAt: number }> {
  ensureEncryptionSecretConfigured(env);

  const sessionId = getSessionId(request);
  if (!sessionId) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Connect an AI key in Settings to enable AI features.');
  }

  const raw = await kvGetText(env, `session:${sessionId}`);
  if (!raw) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'AI session missing. Please reconnect your key.');
  }

  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    await kvDelete(env, `session:${sessionId}`);
    throw new ApiError(403, 'AUTH_EXPIRED', 'AI session is invalid. Reconnect your key to continue.');
  }

  if (!record.expiresAt || record.expiresAt < Date.now()) {
    await kvDelete(env, `session:${sessionId}`);
    throw new ApiError(403, 'AUTH_EXPIRED', 'AI session expired. Reconnect your key to continue.');
  }

  let apiKey = '';
  let usedPreviousSecret = false;
  try {
    const decrypted = await decryptSessionApiKey(record.encryptedApiKey, env);
    apiKey = decrypted.apiKey;
    usedPreviousSecret = decrypted.usedPreviousSecret;
  } catch {
    await kvDelete(env, `session:${sessionId}`);
    throw new ApiError(403, 'AUTH_EXPIRED', 'AI session could not be decrypted. Reconnect your key to continue.');
  }

  if (usedPreviousSecret) {
    try {
      const encryptedApiKey = await encryptApiKey(apiKey, env.KEY_ENCRYPTION_SECRET);
      const remainingTtlSeconds = Math.floor((record.expiresAt - Date.now()) / 1000);
      if (remainingTtlSeconds <= 0) {
        throw new Error('Session expired during secret migration');
      }
      await kvPutText(
        env,
        `session:${sessionId}`,
        JSON.stringify({
          ...record,
          encryptedApiKey,
        }),
        {
          expirationTtl: remainingTtlSeconds,
        }
      );
      reliabilityMetrics.secretRotation.reencryptSuccesses += 1;
    } catch {
      reliabilityMetrics.secretRotation.reencryptFailures += 1;
      // Session still works with previous secret; avoid blocking current request.
    }
  }

  return {
    sessionId,
    provider: record.provider,
    apiKey,
    expiresAt: record.expiresAt,
  };
}

async function loadAccountKeyRecord(userId: string, env: Env): Promise<AccountKeyRecord | null> {
  const raw = await kvGetText(env, `${ACCOUNT_KEY_PREFIX}${userId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AccountKeyRecord;
  } catch {
    await kvDelete(env, `${ACCOUNT_KEY_PREFIX}${userId}`);
    return null;
  }
}

async function storeAccountKeyRecord(userId: string, record: AccountKeyRecord, env: Env): Promise<void> {
  await kvPutText(env, `${ACCOUNT_KEY_PREFIX}${userId}`, JSON.stringify(record));
}

async function requireAiCredentials(
  request: Request,
  env: Env
): Promise<{ provider: AIProvider; apiKey: string; identityKey: string; userId?: string }> {
  ensureEncryptionSecretConfigured(env);

  const userId = await getAuthenticatedUserId(request, env);
  if (userId) {
    const accountRecord = await loadAccountKeyRecord(userId, env);
    if (accountRecord) {
      let apiKey = '';
      let usedPreviousSecret = false;

      try {
        const decrypted = await decryptSessionApiKey(accountRecord.encryptedApiKey, env);
        apiKey = decrypted.apiKey;
        usedPreviousSecret = decrypted.usedPreviousSecret;
      } catch {
        await kvDelete(env, `${ACCOUNT_KEY_PREFIX}${userId}`);
        throw new ApiError(403, 'AUTH_EXPIRED', 'AI key record is invalid. Reconnect your key to continue.');
      }

      if (usedPreviousSecret) {
        try {
          const encryptedApiKey = await encryptApiKey(apiKey, env.KEY_ENCRYPTION_SECRET);
          await storeAccountKeyRecord(
            userId,
            {
              ...accountRecord,
              encryptedApiKey,
              updatedAt: Date.now(),
            },
            env
          );
          reliabilityMetrics.secretRotation.reencryptSuccesses += 1;
        } catch {
          reliabilityMetrics.secretRotation.reencryptFailures += 1;
          // Ignore migration failure and continue with previous-secret decryption.
        }
      }

      return {
        provider: accountRecord.provider,
        apiKey,
        identityKey: `user:${userId}`,
        userId,
      };
    }
  }

  const legacy = await requireLegacySession(request, env);
  return {
    provider: legacy.provider,
    apiKey: legacy.apiKey,
    identityKey: `session:${legacy.sessionId}`,
  };
}

function buildAnalyzePrompt(content: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `Analyze the following note content. Classify it as a NOTE, TASK, or IDEA.
Generate a short, punchy title (max 5 words).
Generate up to 3 relevant tags.

Also extract a due date if one is mentioned or implied (return as ISO date string YYYY-MM-DD, or null if none).
Today's date is ${today}. Examples: "call dentist Thursday" -> next Thursday's date, "due tomorrow" -> tomorrow's date.

Also extract priority if implied: "urgent" for urgent/critical/ASAP items, "normal" for standard items, "low" for low-priority/someday items. Return null if no priority is implied.
Examples: "URGENT: fix bug" -> urgent, "maybe someday learn piano" -> low.

Respond with JSON only.

Content: "${content}"`;
}

function buildBatchPrompt(content: string): string {
  return `You are an expert organizer. The user has provided a "brain dump" of text.
Split this text into distinct, atomic items (Tasks, Ideas, or Notes).

For EACH item, provide:
- content: the extracted content for this specific item
- title: a short punchy title (max 5 words)
- tags: up to 3 relevant tags
- type: one of NOTE, TASK, or IDEA

Respond with a JSON array only.

Input Text: "${content}"`;
}

function buildCleanupPrompt(content: string, mode: CleanupMode): string {
  if (mode === 'batch') {
    return `You are cleaning up a rough notes draft before the user reviews it.
Split the text into distinct, atomic lines and clean each line for clarity.
Do not add new facts. Preserve intent and tone.

Respond with JSON only using this shape:
{
  "cleanedText": "all cleaned items joined with newline characters",
  "items": ["cleaned item 1", "cleaned item 2"]
}

Input Text: "${content}"`;
  }

  return `You are cleaning up a rough notes draft before the user reviews it.
Fix grammar, punctuation, and clarity while preserving the exact meaning.
Do not add new facts or remove important details.

Respond with JSON only using this shape:
{
  "cleanedText": "cleaned draft text"
}

Input Text: "${content}"`;
}

function buildSearchPrompt(query: string, notes: Note[]): string {
  const context = notes
    .map(
      note =>
        `[ID: ${note.id}] [${note.type || 'NOTE'}] [${note.isCompleted ? 'DONE' : 'OPEN'}] (${new Date(
          note.createdAt
        ).toLocaleDateString('en-US')}) ${note.content}`
    )
    .join('\n---\n');

  return `You are a helpful personal assistant.
The user is asking a question about their notes.
Here is the user's question: "${query}"

Here are the user's notes:
${context}

Answer the question based ONLY on the notes provided.
If the answer isn't in the notes, say "I couldn't find that in your notes."
Be concise and friendly.`;
}

function buildDailyBriefPrompt(notes: Note[]): string | null {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

  const activeNotes = notes.filter(note => !note.isArchived);
  const overdueNotes = activeNotes.filter(note => note.dueDate && note.dueDate < startOfToday && !note.isCompleted);
  const dueTodayNotes = activeNotes.filter(
    note => note.dueDate && note.dueDate >= startOfToday && note.dueDate < endOfToday && !note.isCompleted
  );
  const capturedTodayNotes = activeNotes.filter(note => note.createdAt >= startOfToday && note.createdAt < endOfToday);

  const relevant = [...overdueNotes, ...dueTodayNotes, ...capturedTodayNotes];
  if (relevant.length === 0) return null;

  const format = (note: Note) => {
    const parts = [`Title: ${note.title || 'Untitled'}`, `Type: ${note.type || 'NOTE'}`];
    if (note.dueDate) parts.push(`Due: ${new Date(note.dueDate).toLocaleDateString('en-US')}`);
    if (note.priority) parts.push(`Priority: ${note.priority}`);
    if (note.isCompleted) parts.push('Status: completed');
    return parts.join(' | ');
  };

  const sections = [
    overdueNotes.length > 0 ? `OVERDUE (${overdueNotes.length}):\n${overdueNotes.map(format).join('\n')}` : null,
    dueTodayNotes.length > 0 ? `DUE TODAY (${dueTodayNotes.length}):\n${dueTodayNotes.map(format).join('\n')}` : null,
    capturedTodayNotes.length > 0
      ? `CAPTURED TODAY (${capturedTodayNotes.length}):\n${capturedTodayNotes.map(format).join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return `You are a personal productivity assistant. Given these notes and tasks, write a brief 2-3 sentence daily briefing. Mention overdue tasks first, then today's priorities, then notable new captures. Be concise and actionable. Speak directly to the user.\n\n${sections}`;
}

function normalizeCleanupResult(content: string, mode: CleanupMode, parsed: any): { cleanedText: string; items?: string[] } {
  const items = Array.isArray(parsed?.items)
    ? parsed.items
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 25)
    : [];

  const cleaned = typeof parsed?.cleanedText === 'string' ? parsed.cleanedText.trim() : '';

  if (mode === 'batch') {
    const cleanedText = cleaned || items.join('\n') || content.trim();
    return items.length > 0 ? { cleanedText, items } : { cleanedText };
  }

  return {
    cleanedText: cleaned || items[0] || content.trim(),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      metrics.requests += 1;

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204 });
      }

      if (pathname === '/api/v1/metrics' && request.method === 'GET') {
        if (!isLocalDiagnosticsRequest(request)) {
          throw new ApiError(404, 'NOT_FOUND', 'Route not found');
        }
        const remainingMs = Math.max(0, vpsProxyCircuit.openUntil - Date.now());
        return jsonResponse({
          metrics,
          failureCauses: {
            upstream: { ...upstreamFailureCauses },
            provider: { ...providerFailureCauses },
          },
          reliability: {
            authConfig: { ...reliabilityMetrics.authConfig },
            runtimeConfig: { ...reliabilityMetrics.runtimeConfig },
            secretRotation: { ...reliabilityMetrics.secretRotation },
            kvFailures: reliabilityMetrics.kvFailures,
          },
          vpsProxyCircuit: {
            open: remainingMs > 0,
            openUntil: vpsProxyCircuit.openUntil,
            remainingMs,
          },
        });
      }

      if (pathname.startsWith('/api/v2/')) {
        return await proxyToVps(request, env, pathname);
      }

      if (pathname === '/api/v1/auth/status' && request.method === 'GET') {
        const userId = await getAuthenticatedUserId(request, env);
        if (userId) {
          const record = await loadAccountKeyRecord(userId, env);
          if (!record) {
            return jsonResponse({ connected: false, scope: 'account' });
          }
          return jsonResponse({
            connected: true,
            provider: record.provider,
            scope: 'account',
            connectedAt: record.createdAt,
            updatedAt: record.updatedAt,
          });
        }

        const sessionId = getSessionId(request);
        if (!sessionId) return jsonResponse({ connected: false, scope: 'device' });

        const raw = await kvGetText(env, `session:${sessionId}`);
        if (!raw) return jsonResponse({ connected: false, scope: 'device' });

        const record = JSON.parse(raw) as SessionRecord;
        if (record.expiresAt < Date.now()) {
          await kvDelete(env, `session:${sessionId}`);
          return jsonResponse({ connected: false, scope: 'device' });
        }

        return jsonResponse({
          connected: true,
          provider: record.provider,
          expiresAt: record.expiresAt,
          scope: 'device',
        });
      }

      if (pathname === '/api/v1/auth/connect' && request.method === 'POST') {
        requireJsonContentType(request);
        ensureEncryptionSecretConfigured(env);
        const userId = await getAuthenticatedUserId(request, env);
        await enforceRateLimit(request, env, userId ? `user:${userId}` : undefined);
        const body = await parseJson(request);
        const provider = parseProvider(body);
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

        if (!apiKey) {
          throw new ApiError(400, 'BAD_REQUEST', 'API key is required.');
        }

        await validateApiKey(provider, apiKey, env);

        const encryptedApiKey = await encryptApiKey(apiKey, env.KEY_ENCRYPTION_SECRET);

        if (userId) {
          const now = Date.now();
          await storeAccountKeyRecord(
            userId,
            {
              provider,
              encryptedApiKey,
              createdAt: now,
              updatedAt: now,
            },
            env
          );

          return jsonResponse({
            connected: true,
            provider,
            scope: 'account',
            connectedAt: now,
            updatedAt: now,
          });
        }

        const sessionId = crypto.randomUUID();
        const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

        const record: SessionRecord = {
          provider,
          encryptedApiKey,
          createdAt: Date.now(),
          expiresAt,
        };

        await kvPutText(env, `session:${sessionId}`, JSON.stringify(record), {
          expirationTtl: SESSION_TTL_SECONDS,
        });

        return jsonResponse(
          {
            connected: true,
            provider,
            expiresAt,
            scope: 'device',
          },
          200,
          {
            'Set-Cookie': buildCookie(request, sessionId, SESSION_TTL_SECONDS),
          }
        );
      }

      if (pathname === '/api/v1/auth/disconnect' && request.method === 'POST') {
        const userId = await getAuthenticatedUserId(request, env);
        if (userId) {
          await kvDelete(env, `${ACCOUNT_KEY_PREFIX}${userId}`);
          return jsonResponse({
            connected: false,
            scope: 'account',
          });
        }

        const sessionId = getSessionId(request);
        if (sessionId) {
          await kvDelete(env, `session:${sessionId}`);
        }

        return jsonResponse(
          {
            connected: false,
            scope: 'device',
          },
          200,
          {
            'Set-Cookie': clearCookie(request),
          }
        );
      }

      if (pathname.startsWith('/api/v1/ai/') && request.method === 'POST') {
        requireJsonContentType(request);
        const credentials = await requireAiCredentials(request, env);
        await enforceRateLimit(request, env, credentials.identityKey);
        const body = await parseJson(request);

        if (pathname === '/api/v1/ai/analyze') {
          const content = parseContent(body.content);

          const prompt = buildAnalyzePrompt(content);
          const text = await withRetries(() =>
            callProvider(env, credentials.provider, credentials.apiKey, prompt, env.DEFAULT_MODEL)
          );
          const parsed = safeParseJson<any>(text);
          return jsonResponse({
            result: {
              title: parsed.title || 'Quick Note',
              tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3) : [],
              type: parsed.type === 'TASK' || parsed.type === 'IDEA' ? parsed.type : 'NOTE',
              dueDate: typeof parsed.dueDate === 'string' ? parsed.dueDate : undefined,
              priority:
                parsed.priority === 'urgent' || parsed.priority === 'normal' || parsed.priority === 'low'
                  ? parsed.priority
                  : undefined,
            },
          });
        }

        if (pathname === '/api/v1/ai/batch') {
          const content = parseContent(body.content);

          const prompt = buildBatchPrompt(content);
          const text = await withRetries(() =>
            callProvider(env, credentials.provider, credentials.apiKey, prompt, env.DEFAULT_MODEL)
          );
          const parsed = safeParseJson<any>(text);
          const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];

          const results = items.map((item: any) => ({
            content: typeof item.content === 'string' ? item.content : content,
            title: typeof item.title === 'string' ? item.title : 'Quick Note',
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 3) : [],
            type: item.type === 'TASK' || item.type === 'IDEA' ? item.type : 'NOTE',
          }));

          return jsonResponse({ results });
        }

        if (pathname === '/api/v1/ai/cleanup') {
          const content = parseContent(body.content);

          const mode = parseCleanupMode(body.mode ?? 'single');
          const prompt = buildCleanupPrompt(content, mode);
          const text = await withRetries(() =>
            callProvider(env, credentials.provider, credentials.apiKey, prompt, env.DEFAULT_MODEL)
          );
          const parsed = safeParseJson<any>(text);
          return jsonResponse({ result: normalizeCleanupResult(content, mode, parsed) });
        }

        if (pathname === '/api/v1/ai/transcribe') {
          if (credentials.provider !== 'gemini') {
            throw new ApiError(
              400,
              'BAD_REQUEST',
              'Accurate speech transcription currently requires a Gemini provider session.'
            );
          }

          const { audioBase64, mimeType, language } = parseTranscriptionRequest(body);
          const result = await withRetries(() =>
            callGeminiTranscription(credentials.apiKey, audioBase64, mimeType, language)
          );
          return jsonResponse({ result });
        }

        if (pathname === '/api/v1/ai/search') {
          const query = parseQuery(body.query);
          const notes = parseNotesContext(body.notes, MAX_SEARCH_CONTEXT_NOTES);

          const prompt = buildSearchPrompt(query, notes);
          const result = await withRetries(() =>
            callProvider(env, credentials.provider, credentials.apiKey, prompt, env.DEFAULT_MODEL)
          );
          return jsonResponse({ result });
        }

        if (pathname === '/api/v1/ai/daily-brief') {
          const notes = parseNotesContext(body.notes, MAX_DAILY_CONTEXT_NOTES);
          const prompt = buildDailyBriefPrompt(notes);
          if (!prompt) {
            return jsonResponse({ result: null });
          }

          const result = await withRetries(() =>
            callProvider(env, credentials.provider, credentials.apiKey, prompt, env.DEFAULT_MODEL)
          );
          return jsonResponse({ result });
        }

        throw new ApiError(404, 'NOT_FOUND', 'Unknown AI endpoint');
      }

      throw new ApiError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      return errorResponse(error);
    }
  },
};
