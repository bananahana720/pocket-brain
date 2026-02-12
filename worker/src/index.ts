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

interface Env {
  AI_SESSIONS: KVNamespace;
  KEY_ENCRYPTION_SECRET: string;
  KEY_ENCRYPTION_SECRET_PREV?: string;
  DEFAULT_MODEL?: string;
}

type AIProvider = 'gemini' | 'openrouter';
type CleanupMode = 'single' | 'batch';

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

interface Metrics {
  requests: number;
  authFailures: number;
  providerFailures: number;
  retries: number;
  timeouts: number;
  rateLimited: number;
  circuitOpens: number;
}

const SESSION_COOKIE_NAME = 'pb_ai_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const RETRY_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_TRANSCRIPTION_AUDIO_BASE64_CHARS = 6 * 1024 * 1024;
const MAX_NOTE_CONTENT_CHARS = 800;
const MAX_NOTE_TITLE_CHARS = 120;
const MAX_QUERY_CHARS = 400;
const MAX_SEARCH_CONTEXT_NOTES = 40;
const MAX_DAILY_CONTEXT_NOTES = 60;
const MAX_CONTENT_CHARS = 6000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const RATE_LIMIT_BLOCK_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000;

type RateLimitEntry = {
  windowStart: number;
  count: number;
  blockedUntil: number;
};

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number;
};

const metrics: Metrics = {
  requests: 0,
  authFailures: 0,
  providerFailures: 0,
  retries: 0,
  timeouts: 0,
  rateLimited: 0,
  circuitOpens: 0,
};

const rateLimits = new Map<string, RateLimitEntry>();
const providerCircuit: Record<AIProvider, CircuitState> = {
  gemini: { consecutiveFailures: 0, openUntil: 0 },
  openrouter: { consecutiveFailures: 0, openUntil: 0 },
};

class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
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
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      },
      error.status
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

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  if (!forwarded) return 'unknown';
  return forwarded.split(',')[0].trim() || 'unknown';
}

function enforceRateLimit(request: Request, sessionId?: string): void {
  const now = Date.now();
  const key = `${sessionId || 'anon'}:${getClientIp(request)}`;

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

function ensureCircuitClosed(provider: AIProvider): void {
  const state = providerCircuit[provider];
  if (state.openUntil > Date.now()) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Provider is temporarily unavailable. Please retry shortly.', true);
  }
}

function recordProviderSuccess(provider: AIProvider): void {
  providerCircuit[provider].consecutiveFailures = 0;
}

function recordProviderFailure(provider: AIProvider, error: unknown): void {
  if (!isRetryableProviderError(error)) return;

  const state = providerCircuit[provider];
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.consecutiveFailures = 0;
    state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    metrics.circuitOpens += 1;
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
    if (!env.KEY_ENCRYPTION_SECRET_PREV) {
      throw error;
    }

    const apiKey = await decryptApiKey(payload, env.KEY_ENCRYPTION_SECRET_PREV);
    return { apiKey, usedPreviousSecret: true };
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
  try {
    return await request.json();
  } catch {
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
      throw new ApiError(
        response.status,
        response.status === 401 ? 'AUTH_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `Gemini request failed: ${body.slice(0, 200)}`,
        isTransientStatus(response.status)
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
      throw new ApiError(504, 'TIMEOUT', 'Provider request timed out', true);
    }
    throw new ApiError(503, 'NETWORK', 'Network error while contacting Gemini', true);
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
      throw new ApiError(
        response.status,
        response.status === 401 ? 'AUTH_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `Gemini transcription failed: ${body.slice(0, 200)}`,
        isTransientStatus(response.status)
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
      throw new ApiError(504, 'TIMEOUT', 'Provider request timed out', true);
    }
    throw new ApiError(503, 'NETWORK', 'Network error while contacting Gemini', true);
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
      throw new ApiError(
        response.status,
        response.status === 401 ? 'AUTH_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        `OpenRouter request failed: ${body.slice(0, 200)}`,
        isTransientStatus(response.status)
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
      throw new ApiError(504, 'TIMEOUT', 'Provider request timed out', true);
    }
    throw new ApiError(503, 'NETWORK', 'Network error while contacting OpenRouter', true);
  } finally {
    cleanup();
  }
}

async function callProvider(provider: AIProvider, apiKey: string, prompt: string, model?: string): Promise<string> {
  ensureCircuitClosed(provider);

  try {
    const result = provider === 'gemini' ? await callGemini(apiKey, prompt) : await callOpenRouter(apiKey, prompt, model);
    recordProviderSuccess(provider);
    return result;
  } catch (error) {
    recordProviderFailure(provider, error);
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

async function validateApiKey(provider: AIProvider, apiKey: string): Promise<void> {
  const prompt = 'Reply with exactly OK.';
  const text = await withRetries(() => callProvider(provider, apiKey, prompt));
  if (!text.toUpperCase().includes('OK')) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'API key validation failed');
  }
}

async function requireSession(request: Request, env: Env): Promise<{ sessionId: string; provider: AIProvider; apiKey: string; expiresAt: number }> {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Connect an AI key in Settings to enable AI features.');
  }

  const raw = await env.AI_SESSIONS.get(`session:${sessionId}`, 'text');
  if (!raw) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'AI session missing. Please reconnect your key.');
  }

  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    await env.AI_SESSIONS.delete(`session:${sessionId}`);
    throw new ApiError(403, 'AUTH_EXPIRED', 'AI session is invalid. Reconnect your key to continue.');
  }

  if (!record.expiresAt || record.expiresAt < Date.now()) {
    await env.AI_SESSIONS.delete(`session:${sessionId}`);
    throw new ApiError(403, 'AUTH_EXPIRED', 'AI session expired. Reconnect your key to continue.');
  }

  let apiKey = '';
  let usedPreviousSecret = false;
  try {
    const decrypted = await decryptSessionApiKey(record.encryptedApiKey, env);
    apiKey = decrypted.apiKey;
    usedPreviousSecret = decrypted.usedPreviousSecret;
  } catch {
    await env.AI_SESSIONS.delete(`session:${sessionId}`);
    throw new ApiError(403, 'AUTH_EXPIRED', 'AI session could not be decrypted. Reconnect your key to continue.');
  }

  if (usedPreviousSecret) {
    try {
      const encryptedApiKey = await encryptApiKey(apiKey, env.KEY_ENCRYPTION_SECRET);
      const remainingTtlSeconds = Math.floor((record.expiresAt - Date.now()) / 1000);
      if (remainingTtlSeconds <= 0) {
        throw new Error('Session expired during secret migration');
      }
      await env.AI_SESSIONS.put(
        `session:${sessionId}`,
        JSON.stringify({
          ...record,
          encryptedApiKey,
        }),
        {
          expirationTtl: remainingTtlSeconds,
        }
      );
    } catch {
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
        return jsonResponse({ metrics });
      }

      if (pathname === '/api/v1/auth/status' && request.method === 'GET') {
        const sessionId = getSessionId(request);
        if (!sessionId) return jsonResponse({ connected: false });

        const raw = await env.AI_SESSIONS.get(`session:${sessionId}`, 'text');
        if (!raw) return jsonResponse({ connected: false });

        const record = JSON.parse(raw) as SessionRecord;
        if (record.expiresAt < Date.now()) {
          await env.AI_SESSIONS.delete(`session:${sessionId}`);
          return jsonResponse({ connected: false });
        }

        return jsonResponse({
          connected: true,
          provider: record.provider,
          expiresAt: record.expiresAt,
        });
      }

      if (pathname === '/api/v1/auth/connect' && request.method === 'POST') {
        enforceRateLimit(request);
        const body = await parseJson(request);
        const provider = parseProvider(body);
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

        if (!apiKey) {
          throw new ApiError(400, 'BAD_REQUEST', 'API key is required.');
        }

        await validateApiKey(provider, apiKey);

        const encryptedApiKey = await encryptApiKey(apiKey, env.KEY_ENCRYPTION_SECRET);
        const sessionId = crypto.randomUUID();
        const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

        const record: SessionRecord = {
          provider,
          encryptedApiKey,
          createdAt: Date.now(),
          expiresAt,
        };

        await env.AI_SESSIONS.put(`session:${sessionId}`, JSON.stringify(record), {
          expirationTtl: SESSION_TTL_SECONDS,
        });

        return jsonResponse(
          {
            connected: true,
            provider,
            expiresAt,
          },
          200,
          {
            'Set-Cookie': buildCookie(request, sessionId, SESSION_TTL_SECONDS),
          }
        );
      }

      if (pathname === '/api/v1/auth/disconnect' && request.method === 'POST') {
        const sessionId = getSessionId(request);
        if (sessionId) {
          await env.AI_SESSIONS.delete(`session:${sessionId}`);
        }

        return jsonResponse(
          {
            connected: false,
          },
          200,
          {
            'Set-Cookie': clearCookie(request),
          }
        );
      }

      if (pathname.startsWith('/api/v1/ai/') && request.method === 'POST') {
        enforceRateLimit(request, getSessionId(request) || undefined);
        const session = await requireSession(request, env);
        const body = await parseJson(request);

        if (pathname === '/api/v1/ai/analyze') {
          const content = parseContent(body.content);

          const prompt = buildAnalyzePrompt(content);
          const text = await withRetries(() => callProvider(session.provider, session.apiKey, prompt, env.DEFAULT_MODEL));
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
          const text = await withRetries(() => callProvider(session.provider, session.apiKey, prompt, env.DEFAULT_MODEL));
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
          const text = await withRetries(() => callProvider(session.provider, session.apiKey, prompt, env.DEFAULT_MODEL));
          const parsed = safeParseJson<any>(text);
          return jsonResponse({ result: normalizeCleanupResult(content, mode, parsed) });
        }

        if (pathname === '/api/v1/ai/transcribe') {
          if (session.provider !== 'gemini') {
            throw new ApiError(
              400,
              'BAD_REQUEST',
              'Accurate speech transcription currently requires a Gemini provider session.'
            );
          }

          const { audioBase64, mimeType, language } = parseTranscriptionRequest(body);
          const result = await withRetries(() =>
            callGeminiTranscription(session.apiKey, audioBase64, mimeType, language)
          );
          return jsonResponse({ result });
        }

        if (pathname === '/api/v1/ai/search') {
          const query = parseQuery(body.query);
          const notes = parseNotesContext(body.notes, MAX_SEARCH_CONTEXT_NOTES);

          const prompt = buildSearchPrompt(query, notes);
          const result = await withRetries(() => callProvider(session.provider, session.apiKey, prompt, env.DEFAULT_MODEL));
          return jsonResponse({ result });
        }

        if (pathname === '/api/v1/ai/daily-brief') {
          const notes = parseNotesContext(body.notes, MAX_DAILY_CONTEXT_NOTES);
          const prompt = buildDailyBriefPrompt(notes);
          if (!prompt) {
            return jsonResponse({ result: null });
          }

          const result = await withRetries(() => callProvider(session.provider, session.apiKey, prompt, env.DEFAULT_MODEL));
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
