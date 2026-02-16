import type { GoogleGenAI } from '@google/genai';
import { AIAnalysisResult, AIAuthState, AIProvider, Note, NoteType } from '../types';
import { incrementMetric, recordAiPayloadBytes } from '../utils/telemetry';
import { apiFetch } from './apiClient';

const OPENROUTER_MODEL = 'google/gemini-2.5-flash';
const USE_AI_PROXY = !!(import.meta.env?.PROD || import.meta.env?.VITE_USE_AI_PROXY === 'true');
const PROXY_TIMEOUT_MS = 12000;
const PROXY_RETRIES = 2;
const MAX_NOTE_CONTENT_CHARS = 800;
const MAX_NOTE_TITLE_CHARS = 120;
const MAX_QUERY_CHARS = 400;
const MAX_SEARCH_CONTEXT_NOTES = 40;
const MAX_DAILY_CONTEXT_NOTES = 60;
const MAX_BATCH_ITEMS = 25;
const BATCH_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};
const BATCH_COUNT_PATTERN =
  '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';

type GoogleGenAIModule = typeof import('@google/genai');
let googleGenAIModulePromise: Promise<GoogleGenAIModule> | null = null;

type Provider = 'gemini' | 'openrouter';
export type AIErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BAD_REQUEST'
  | 'UNKNOWN';

export class AIServiceError extends Error {
  code: AIErrorCode;
  retryable: boolean;

  constructor(message: string, code: AIErrorCode, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
}

export type DraftCleanupMode = 'single' | 'batch';

export interface DraftCleanupResult {
  cleanedText: string;
  items?: string[];
}

export interface SpeechTranscriptionOptions extends RequestOptions {
  language?: string;
}

type NoteContext = Pick<
  Note,
  'id' | 'content' | 'createdAt' | 'title' | 'tags' | 'type' | 'isCompleted' | 'isArchived' | 'dueDate' | 'priority'
>;
type BatchItemType = 'NOTE' | 'TASK' | 'IDEA';
type BatchPromptHints = {
  requestedCount: number | null;
  requestedType: BatchItemType | null;
  generationLikely: boolean;
};
type BatchCountClause = {
  count: number;
  type: BatchItemType;
  start: number;
  end: number;
};

function clampText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function toNoteContext(note: Note): NoteContext {
  return {
    id: note.id,
    content: clampText(note.content || '', MAX_NOTE_CONTENT_CHARS),
    createdAt: note.createdAt,
    ...(note.title ? { title: clampText(note.title, MAX_NOTE_TITLE_CHARS) } : {}),
    ...(note.tags?.length ? { tags: note.tags.slice(0, 6).map(tag => clampText(tag, 24)) } : {}),
    ...(note.type ? { type: note.type } : {}),
    ...(typeof note.isCompleted === 'boolean' ? { isCompleted: note.isCompleted } : {}),
    ...(typeof note.isArchived === 'boolean' ? { isArchived: note.isArchived } : {}),
    ...(typeof note.dueDate === 'number' ? { dueDate: note.dueDate } : {}),
    ...(note.priority ? { priority: note.priority } : {}),
  };
}

function scoreNoteForQuery(note: Note, terms: string[]): number {
  if (terms.length === 0) return 0;
  const content = `${note.title || ''} ${note.content || ''} ${(note.tags || []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (content.includes(term)) score += 1;
    if (note.title?.toLowerCase().includes(term)) score += 1;
    if ((note.tags || []).some(tag => tag.toLowerCase() === term)) score += 2;
  }
  return score;
}

function selectSearchContextNotes(notes: Note[], query: string): NoteContext[] {
  const normalizedQuery = query.trim().toLowerCase().slice(0, MAX_QUERY_CHARS);
  const terms = normalizedQuery.split(/\s+/).map(term => term.trim()).filter(Boolean).slice(0, 8);

  return [...notes]
    .sort((a, b) => {
      const scoreDiff = scoreNoteForQuery(b, terms) - scoreNoteForQuery(a, terms);
      if (scoreDiff !== 0) return scoreDiff;
      return b.createdAt - a.createdAt;
    })
    .slice(0, MAX_SEARCH_CONTEXT_NOTES)
    .map(toNoteContext);
}

function selectDailyBriefContextNotes(notes: Note[]): NoteContext[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

  const activeNotes = notes.filter(note => !note.isArchived);
  const overdue = activeNotes
    .filter(note => note.dueDate && note.dueDate < startOfToday && !note.isCompleted)
    .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0))
    .slice(0, 24);
  const dueToday = activeNotes
    .filter(note => note.dueDate && note.dueDate >= startOfToday && note.dueDate < endOfToday && !note.isCompleted)
    .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0))
    .slice(0, 24);
  const capturedToday = activeNotes
    .filter(note => note.createdAt >= startOfToday && note.createdAt < endOfToday)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24);

  const selected = [...overdue, ...dueToday, ...capturedToday];
  const seen = new Set<string>();
  const deduped: Note[] = [];
  for (const note of selected) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    deduped.push(note);
  }

  return deduped.slice(0, MAX_DAILY_CONTEXT_NOTES).map(toNoteContext);
}

function getDevGeminiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

function getDevOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY || '';
}

function getProvider(): Provider | null {
  return getAvailableProviders()[0] || null;
}

function getAvailableProviders(): Provider[] {
  const providers: Provider[] = [];
  const openRouter = getDevOpenRouterKey();
  const gemini = getDevGeminiKey();
  if (openRouter) providers.push('openrouter');
  if (gemini) providers.push('gemini');
  return providers;
}

function shouldFallbackProvider(error: unknown): boolean {
  if (!(error instanceof AIServiceError) || !error.retryable) return false;
  return (
    error.code === 'PROVIDER_UNAVAILABLE' ||
    error.code === 'RATE_LIMITED' ||
    error.code === 'TIMEOUT' ||
    error.code === 'NETWORK'
  );
}

async function withLocalProviderFallback<T>(handler: (provider: Provider) => Promise<T>): Promise<T> {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new AIServiceError('No API key configured for AI usage.', 'AUTH_REQUIRED', false);
  }

  let lastError: unknown = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      return await handler(provider);
    } catch (error) {
      lastError = error;
      const hasFallback = i < providers.length - 1;
      if (!hasFallback || !shouldFallbackProvider(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new AIServiceError('AI request failed.', 'UNKNOWN', false);
}

async function loadGoogleGenAIModule(): Promise<GoogleGenAIModule> {
  if (!googleGenAIModulePromise) {
    googleGenAIModulePromise = import('@google/genai');
  }
  return googleGenAIModulePromise;
}

async function getGeminiRuntime(): Promise<{ ai: GoogleGenAI; Type: GoogleGenAIModule['Type'] } | null> {
  const key = getDevGeminiKey();
  if (!key) {
    return null;
  }

  const { GoogleGenAI, Type } = await loadGoogleGenAIModule();
  return { ai: new GoogleGenAI({ apiKey: key }), Type };
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function getBackoffMs(attempt: number): number {
  const base = 250 * Math.pow(2, attempt);
  return Math.min(1500, base) + Math.floor(Math.random() * 120);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timeoutController(parentSignal?: AbortSignal, timeoutMs = PROXY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);

  const onAbort = () => {
    controller.abort(parentSignal?.reason || new DOMException('Aborted', 'AbortError'));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onAbort();
    } else {
      parentSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function mapProxyError(status: number, payload: any): AIServiceError {
  const code = payload?.error?.code as AIErrorCode | undefined;
  const message = payload?.error?.message || 'AI request failed';
  const retryable = !!payload?.error?.retryable;

  if (code) return new AIServiceError(message, code, retryable);

  if (status === 401) return new AIServiceError(message, 'AUTH_REQUIRED', false);
  if (status === 403) return new AIServiceError(message, 'AUTH_EXPIRED', false);
  if (status === 429) return new AIServiceError(message, 'RATE_LIMITED', true);
  if (status >= 500) return new AIServiceError(message, 'PROVIDER_UNAVAILABLE', true);
  if (status >= 400) return new AIServiceError(message, 'BAD_REQUEST', false);
  return new AIServiceError(message, 'UNKNOWN', false);
}

async function proxyJson<T>(
  url: string,
  init: RequestInit,
  options?: RequestOptions
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= PROXY_RETRIES; attempt++) {
    if (options?.signal?.aborted) {
      throw new AIServiceError('Request canceled', 'NETWORK', false);
    }

    const { signal, cleanup } = timeoutController(options?.signal, PROXY_TIMEOUT_MS);

    try {
      const response = await apiFetch(url, {
        ...init,
        signal,
      });

      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : { error: { message: await response.text() } };

      if (!response.ok) {
        const mapped = mapProxyError(response.status, payload);
        if (!mapped.retryable || attempt === PROXY_RETRIES || !isTransientStatus(response.status)) {
          throw mapped;
        }
        lastError = mapped;
        await sleep(getBackoffMs(attempt));
        continue;
      }

      return payload as T;
    } catch (error) {
      if (error instanceof AIServiceError) {
        cleanup();
        throw error;
      }

      const isAbort = error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
      if (isAbort) {
        const timeoutError = new AIServiceError('AI request timed out', 'TIMEOUT', true);
        if (attempt === PROXY_RETRIES) {
          cleanup();
          throw timeoutError;
        }
        lastError = timeoutError;
        await sleep(getBackoffMs(attempt));
        cleanup();
        continue;
      }

      const networkError = new AIServiceError('Network error while contacting AI service', 'NETWORK', true);
      if (attempt === PROXY_RETRIES) {
        cleanup();
        throw networkError;
      }
      lastError = networkError;
      await sleep(getBackoffMs(attempt));
    } finally {
      cleanup();
    }
  }

  throw lastError || new AIServiceError('Unknown AI proxy error', 'UNKNOWN', false);
}

async function proxyPost<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  const requestBody = JSON.stringify(body);
  if (path.startsWith('/api/v1/ai/')) {
    incrementMetric('ai_payload_samples');
    recordAiPayloadBytes(new TextEncoder().encode(requestBody).byteLength);
  }

  return proxyJson<T>(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    },
    options
  );
}

async function proxyGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return proxyJson<T>(path, { method: 'GET' }, options);
}

async function openRouterChat(
  prompt: string,
  jsonSchema?: Record<string, unknown>
): Promise<string | null> {
  const key = getDevOpenRouterKey();
  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };

  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: jsonSchema,
      },
    };
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
      'X-Title': 'PocketBrain',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new AIServiceError(`OpenRouter error ${res.status}: ${err}`, 'PROVIDER_UNAVAILABLE', isTransientStatus(res.status));
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

function parseNoteType(typeStr: string): NoteType {
  if (typeStr === 'TASK') return NoteType.TASK;
  if (typeStr === 'IDEA') return NoteType.IDEA;
  return NoteType.NOTE;
}

function parseAnalysisResult(result: Record<string, unknown>): AIAnalysisResult {
  return {
    title: (result.title as string) || 'Quick Note',
    tags: (result.tags as string[]) || [],
    type: parseNoteType((result.type as string) || 'NOTE'),
    dueDate: (result.dueDate as string) || undefined,
    priority: (result.priority as 'urgent' | 'normal' | 'low') || undefined,
  };
}

function normalizeCleanupResult(
  source: string,
  mode: DraftCleanupMode,
  result: unknown
): DraftCleanupResult {
  const parsed = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 25);

  const cleaned = typeof parsed.cleanedText === 'string' ? parsed.cleanedText.trim() : '';

  if (mode === 'batch') {
    const cleanedText = cleaned || items.join('\n') || source.trim();
    return items.length > 0 ? { cleanedText, items } : { cleanedText };
  }

  return {
    cleanedText: cleaned || items[0] || source.trim(),
  };
}

function parseBatchRequestedType(value: string): BatchItemType | null {
  if (/\bideas?\b/i.test(value)) return 'IDEA';
  if (/\btasks?\b/i.test(value)) return 'TASK';
  if (/\bnotes?\b/i.test(value)) return 'NOTE';
  return null;
}

function parseBatchCountToken(token: string | undefined): number | null {
  if (!token) return null;
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;

  if (/^\d{1,3}$/.test(normalized)) {
    const numeric = Number.parseInt(normalized, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.min(MAX_BATCH_ITEMS, numeric);
  }

  const fromWord = BATCH_COUNT_WORDS[normalized];
  if (!fromWord) return null;
  return Math.min(MAX_BATCH_ITEMS, fromWord);
}

function collectBatchRequestedTypes(value: string): BatchItemType[] {
  const found = new Set<BatchItemType>();
  for (const match of value.matchAll(/\b(ideas?|tasks?|notes?)\b/gi)) {
    const type = parseBatchRequestedType(match[1] || '');
    if (type) {
      found.add(type);
    }
  }
  return Array.from(found);
}

function collectBatchCountClauses(content: string): BatchCountClause[] {
  const clauses: BatchCountClause[] = [];
  const patterns = [
    new RegExp(`\\b${BATCH_COUNT_PATTERN}\\s+(?:new\\s+|distinct\\s+|different\\s+|fresh\\s+)?(ideas?|tasks?|notes?)\\b`, 'gi'),
    new RegExp(`\\b${BATCH_COUNT_PATTERN}\\s+(?:amount|number)\\s+of\\s+(ideas?|tasks?|notes?)\\b`, 'gi'),
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const count = parseBatchCountToken(match[1]);
      const type = parseBatchRequestedType(match[2] || '');
      if (!count || !type || match.index === undefined) continue;
      clauses.push({
        count,
        type,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  if (clauses.length <= 1) {
    return clauses;
  }

  const seen = new Set<string>();
  return clauses
    .sort((a, b) => a.start - b.start)
    .filter(clause => {
      const key = `${clause.start}:${clause.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function supportsAdditiveCountBridge(segment: string): boolean {
  const normalized = segment.trim().toLowerCase();
  if (!normalized) return true;
  if (/\b(or|either|versus|vs)\b|[\/|]/i.test(normalized)) return false;
  if (/\b(and|plus|also|then)\b/i.test(normalized)) return true;
  return /^[,;+&\s]+$/.test(segment);
}

function inferRequestedCountFromClauses(content: string, clauses: BatchCountClause[]): number | null {
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0].count;

  for (let index = 1; index < clauses.length; index += 1) {
    const previous = clauses[index - 1];
    const current = clauses[index];
    const bridge = content.slice(previous.end, current.start);
    if (!supportsAdditiveCountBridge(bridge)) {
      return null;
    }
  }

  const total = clauses.reduce((sum, clause) => sum + clause.count, 0);
  return Math.min(MAX_BATCH_ITEMS, total);
}

function inferBatchPromptHints(content: string): BatchPromptHints {
  const generationLikely =
    /\b(create|generate|brainstorm|come up with|give me|list|draft|produce|make)\b/i.test(content) ||
    new RegExp(`^\\s*${BATCH_COUNT_PATTERN}\\s+(ideas?|tasks?|notes?)\\b`, 'i').test(content) ||
    /\b(?:amount|number)\s+of\s+(ideas?|tasks?|notes?)\b/i.test(content);
  const looseGenerationCount = new RegExp(
    `\\b(?:create|generate|brainstorm|list|make|produce)\\s+(?:me\\s+)?${BATCH_COUNT_PATTERN}\\b`,
    'i'
  );

  let requestedCount: number | null = null;
  let requestedType: BatchItemType | null = null;
  let explicitClauseCount = 0;

  if (generationLikely) {
    const explicitClauses = collectBatchCountClauses(content);
    explicitClauseCount = explicitClauses.length;
    if (explicitClauses.length > 0) {
      requestedCount = inferRequestedCountFromClauses(content, explicitClauses);
      const explicitTypes = new Set(explicitClauses.map(clause => clause.type));
      if (explicitTypes.size === 1) {
        requestedType = explicitClauses[0].type;
      }
    }
  }

  if (requestedCount === null && generationLikely && explicitClauseCount === 0) {
    const looseCountMatch = content.match(looseGenerationCount);
    requestedCount = parseBatchCountToken(looseCountMatch?.[1]);
  }

  if (!requestedType && generationLikely) {
    const requestedTypes = collectBatchRequestedTypes(content);
    if (requestedTypes.length === 1) {
      requestedType = requestedTypes[0];
    }
  }

  return {
    requestedCount,
    requestedType,
    generationLikely,
  };
}

function parseBatchResponseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1].trim());
    }
    const firstArray = text.match(/\[[\s\S]*\]/);
    const firstObject = text.match(/\{[\s\S]*\}/);
    const candidate =
      firstArray && firstObject
        ? (firstArray.index ?? Number.MAX_SAFE_INTEGER) <= (firstObject.index ?? Number.MAX_SAFE_INTEGER)
          ? firstArray[0]
          : firstObject[0]
        : firstArray?.[0] || firstObject?.[0];
    if (!candidate) throw new Error('Batch response was not valid JSON');
    return JSON.parse(candidate);
  }
}

function extractBatchItems(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
    if (Array.isArray(obj.results)) return obj.results as Record<string, unknown>[];
  }
  return [];
}

function normalizeBatchResults(
  rawItems: Record<string, unknown>[],
  fallbackContent: string,
  hints: BatchPromptHints
): AIAnalysisResult[] {
  const normalized = rawItems.slice(0, MAX_BATCH_ITEMS).map(item => {
    const itemType = typeof item.type === 'string' ? (item.type as string) : 'NOTE';
    const type = hints.generationLikely && hints.requestedType ? parseNoteType(hints.requestedType) : parseNoteType(itemType);
    const content = typeof item.content === 'string' && item.content.trim() ? item.content.trim() : fallbackContent;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Quick Note';
    const tags = Array.isArray(item.tags)
      ? item.tags
          .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return {
      content,
      title,
      tags,
      type,
    };
  });

  if (hints.requestedCount && normalized.length > hints.requestedCount) {
    return normalized.slice(0, hints.requestedCount);
  }

  return normalized;
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

function buildBatchPrompt(content: string, hints: BatchPromptHints): string {
  const countInstruction = hints.requestedCount
    ? `The user requested ${hints.requestedCount} items. Return exactly ${hints.requestedCount} items.`
    : 'If the user asks for a specific item count, return exactly that many items.';
  const typeInstruction = hints.requestedType
    ? `The user asked for ${hints.requestedType} items. Use type="${hints.requestedType}" for generated items unless the input clearly mixes types.`
    : 'Respect explicit type hints (ideas -> IDEA, tasks -> TASK, notes -> NOTE).';

  return `You are Smart Batch for a notes app.
Decide whether the input should be SPLIT (extract existing thoughts) or GENERATE (create new ideas/tasks/notes).

Rules:
- SPLIT mode: preserve meaning, split into atomic items, do not invent facts.
- GENERATE mode: create useful, diverse, concise items aligned with the request.
- Return between 1 and ${MAX_BATCH_ITEMS} items.
- ${countInstruction}
- ${typeInstruction}

For each item include:
- content: the item text
- title: short title (max 5 words)
- tags: up to 3 relevant tags
- type: NOTE, TASK, or IDEA

Respond with JSON only in this shape:
{
  "mode": "split" | "generate",
  "items": [
    {
      "content": "...",
      "title": "...",
      "tags": ["..."],
      "type": "NOTE" | "TASK" | "IDEA"
    }
  ]
}

Input Text: "${content}"`;
}

function buildCleanupPrompt(content: string, mode: DraftCleanupMode): string {
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

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    type: { type: 'string', enum: ['NOTE', 'TASK', 'IDEA'] },
    dueDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    priority: { anyOf: [{ type: 'string', enum: ['urgent', 'normal', 'low'] }, { type: 'null' }] },
  },
  required: ['title', 'tags', 'type', 'dueDate', 'priority'],
  additionalProperties: false,
};

const BATCH_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['split', 'generate'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          type: { type: 'string', enum: ['NOTE', 'TASK', 'IDEA'] },
        },
        required: ['content', 'title', 'tags', 'type'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const CLEANUP_SCHEMA = {
  type: 'object',
  properties: {
    cleanedText: { type: 'string' },
    items: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['cleanedText'],
  additionalProperties: false,
};

function hasProxy(): boolean {
  return USE_AI_PROXY;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new AIServiceError('Failed to encode audio payload', 'BAD_REQUEST', false));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new AIServiceError('Failed to encode audio payload', 'BAD_REQUEST', false));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new AIServiceError('Failed to read audio payload', 'BAD_REQUEST', false));
    reader.readAsDataURL(blob);
  });
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getAIAuthStatus(options?: RequestOptions): Promise<AIAuthState> {
  if (!hasProxy()) {
    const provider = getProvider();
    return {
      connected: !!provider,
      ...(provider ? { provider } : {}),
      ...(provider ? { expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 } : {}),
      ...(provider ? { scope: 'device' as const } : {}),
      ...(provider ? { connectedAt: Date.now(), updatedAt: Date.now() } : {}),
    };
  }

  return proxyGet<AIAuthState>('/api/v1/auth/status', options);
}

export async function connectAIProvider(
  provider: AIProvider,
  apiKey: string,
  options?: RequestOptions
): Promise<AIAuthState> {
  if (!hasProxy()) {
    throw new AIServiceError('AI proxy is disabled in this environment.', 'BAD_REQUEST', false);
  }

  return proxyPost<AIAuthState>('/api/v1/auth/connect', { provider, apiKey }, options);
}

export async function disconnectAIProvider(options?: RequestOptions): Promise<AIAuthState> {
  if (!hasProxy()) {
    return { connected: false };
  }

  return proxyPost<AIAuthState>('/api/v1/auth/disconnect', {}, options);
}

export const analyzeNote = async (
  content: string,
  options?: RequestOptions
): Promise<AIAnalysisResult | null> => {
  if (hasProxy()) {
    const payload = await proxyPost<{ result: AIAnalysisResult | null }>('/api/v1/ai/analyze', { content }, options);
    return payload.result;
  }

  try {
    return await withLocalProviderFallback(async provider => {
      if (provider === 'openrouter') {
        const text = await openRouterChat(buildAnalyzePrompt(content), ANALYSIS_SCHEMA);
        if (!text) return null;
        return parseAnalysisResult(JSON.parse(text));
      }

      const gemini = await getGeminiRuntime();
      if (!gemini) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);
      const { ai, Type } = gemini;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: buildAnalyzePrompt(content),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              type: { type: Type.STRING, enum: ['NOTE', 'TASK', 'IDEA'] },
              dueDate: { type: Type.STRING, nullable: true },
              priority: { type: Type.STRING, enum: ['urgent', 'normal', 'low'], nullable: true },
            },
            required: ['title', 'tags', 'type'],
          },
        },
      });

      const text = response.text;
      if (!text) return null;
      return parseAnalysisResult(JSON.parse(text));
    });
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError('Error analyzing note.', 'PROVIDER_UNAVAILABLE', true);
  }
};

export const processBatchEntry = async (
  content: string,
  options?: RequestOptions
): Promise<AIAnalysisResult[]> => {
  const batchHints = inferBatchPromptHints(content);

  if (hasProxy()) {
    const payload = await proxyPost<{ results: AIAnalysisResult[] }>('/api/v1/ai/batch', { content }, options);
    return payload.results;
  }

  try {
    return await withLocalProviderFallback(async provider => {
      if (provider === 'openrouter') {
        const text = await openRouterChat(buildBatchPrompt(content, batchHints), BATCH_SCHEMA);
        if (!text) return [];
        const parsed = parseBatchResponseJson(text);
        return normalizeBatchResults(extractBatchItems(parsed), content, batchHints);
      }

      const gemini = await getGeminiRuntime();
      if (!gemini) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);
      const { ai, Type } = gemini;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: buildBatchPrompt(content, batchHints),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mode: { type: Type.STRING, enum: ['split', 'generate'] },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    content: { type: Type.STRING },
                    title: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    type: { type: Type.STRING, enum: ['NOTE', 'TASK', 'IDEA'] },
                  },
                  required: ['content', 'title', 'tags', 'type'],
                },
              },
            },
            required: ['items'],
          },
        },
      });

      const text = response.text;
      if (!text) return [];

      const parsed = parseBatchResponseJson(text);
      return normalizeBatchResults(extractBatchItems(parsed), content, batchHints);
    });
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError('Error processing batch.', 'PROVIDER_UNAVAILABLE', true);
  }
};

export const cleanupNoteDraft = async (
  content: string,
  mode: DraftCleanupMode = 'single',
  options?: RequestOptions
): Promise<DraftCleanupResult> => {
  const trimmed = content.trim();
  if (!trimmed) {
    return { cleanedText: '' };
  }

  if (hasProxy()) {
    const payload = await proxyPost<{ result: DraftCleanupResult }>(
      '/api/v1/ai/cleanup',
      { content: trimmed, mode },
      options
    );
    return normalizeCleanupResult(trimmed, mode, payload.result);
  }

  try {
    return await withLocalProviderFallback(async provider => {
      if (provider === 'openrouter') {
        const text = await openRouterChat(buildCleanupPrompt(trimmed, mode), CLEANUP_SCHEMA);
        if (!text) {
          return { cleanedText: trimmed };
        }
        return normalizeCleanupResult(trimmed, mode, JSON.parse(text));
      }

      const gemini = await getGeminiRuntime();
      if (!gemini) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);
      const { ai, Type } = gemini;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: buildCleanupPrompt(trimmed, mode),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cleanedText: { type: Type.STRING },
              items: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['cleanedText'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        return { cleanedText: trimmed };
      }

      return normalizeCleanupResult(trimmed, mode, JSON.parse(text));
    });
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError('Error cleaning note draft.', 'PROVIDER_UNAVAILABLE', true);
  }
};

export const transcribeAudio = async (
  audio: Blob,
  options?: SpeechTranscriptionOptions
): Promise<string> => {
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new AIServiceError('Audio payload is empty.', 'BAD_REQUEST', false);
  }

  if (!hasProxy()) {
    throw new AIServiceError('Accurate speech transcription requires AI proxy mode.', 'BAD_REQUEST', false);
  }

  const base64 = await blobToBase64(audio);
  const payload = await proxyPost<{ result: string }>(
    '/api/v1/ai/transcribe',
    {
      audioBase64: base64,
      mimeType: audio.type || 'audio/webm',
      ...(options?.language ? { language: options.language } : {}),
    },
    options
  );

  return normalizeTranscript(payload.result || '');
};

export const generateDailyBrief = async (notes: Note[], options?: RequestOptions): Promise<string | null> => {
  const contextNotes = selectDailyBriefContextNotes(notes);
  if (contextNotes.length === 0) return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const overdueNotes = contextNotes.filter(n => n.dueDate && n.dueDate < startOfToday && !n.isCompleted);
  const dueTodayNotes = contextNotes.filter(
    n => n.dueDate && n.dueDate >= startOfToday && n.dueDate < endOfToday && !n.isCompleted
  );
  const capturedTodayNotes = contextNotes.filter(n => n.createdAt >= startOfToday && n.createdAt < endOfToday);

  if (hasProxy()) {
    const payload = await proxyPost<{ result: string | null }>('/api/v1/ai/daily-brief', { notes: contextNotes }, options);
    return payload.result;
  }

  if (getAvailableProviders().length === 0) {
    return 'I need an API key to generate your daily brief.';
  }

  const formatNote = (n: NoteContext) => {
    const parts: string[] = [];
    parts.push(`Title: ${n.title || 'Untitled'}`);
    parts.push(`Type: ${n.type || 'NOTE'}`);
    if (n.dueDate) parts.push(`Due: ${new Date(n.dueDate).toLocaleDateString()}`);
    if (n.priority) parts.push(`Priority: ${n.priority}`);
    if (n.isCompleted) parts.push('Status: completed');
    return parts.join(' | ');
  };

  const context = [
    overdueNotes.length > 0
      ? `OVERDUE (${overdueNotes.length}):\n${overdueNotes.map(formatNote).join('\n')}`
      : null,
    dueTodayNotes.length > 0
      ? `DUE TODAY (${dueTodayNotes.length}):\n${dueTodayNotes.map(formatNote).join('\n')}`
      : null,
    capturedTodayNotes.length > 0
      ? `CAPTURED TODAY (${capturedTodayNotes.length}):\n${capturedTodayNotes.map(formatNote).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n');

  const prompt = `You are a personal productivity assistant. Given these notes and tasks, write a brief 2-3 sentence daily briefing. Mention overdue tasks first, then today's priorities, then notable new captures. Be concise and actionable. Speak directly to the user.\n\n${context}`;

  try {
    return await withLocalProviderFallback(async provider => {
      if (provider === 'openrouter') {
        return (await openRouterChat(prompt)) || "Couldn't generate your daily brief right now.";
      }

      const gemini = await getGeminiRuntime();
      if (!gemini) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);
      const { ai } = gemini;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text || "Couldn't generate your daily brief right now.";
    });
  } catch {
    return 'Sorry, I had trouble generating your daily brief.';
  }
};

export const askMyNotes = async (query: string, notes: Note[], options?: RequestOptions): Promise<string> => {
  const normalizedQuery = query.trim().slice(0, MAX_QUERY_CHARS);
  const contextNotes = selectSearchContextNotes(notes, normalizedQuery);

  if (hasProxy()) {
    const payload = await proxyPost<{ result: string }>(
      '/api/v1/ai/search',
      { query: normalizedQuery, notes: contextNotes },
      options
    );
    return payload.result;
  }

  if (getAvailableProviders().length === 0) return 'I need an API key to help you search.';
  const context = contextNotes
    .map(
      n =>
        `[ID: ${n.id}] [${n.type || 'NOTE'}] [${n.isCompleted ? 'DONE' : 'OPEN'}] (${new Date(
          n.createdAt
        ).toLocaleDateString()}) ${n.content}`
    )
    .join('\n---\n');

  const prompt = `You are a helpful personal assistant.
The user is asking a question about their notes.
Here is the user's question: "${normalizedQuery}"

Here are the user's notes:
${context}

  Answer the question based ONLY on the notes provided.
If the answer isn't in the notes, say "I couldn't find that in your notes."
Be concise and friendly.`;

  try {
    return await withLocalProviderFallback(async provider => {
      if (provider === 'openrouter') {
        return (await openRouterChat(prompt)) || 'No answer generated.';
      }

      const gemini = await getGeminiRuntime();
      if (!gemini) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);
      const { ai } = gemini;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text || 'No answer generated.';
    });
  } catch {
    return 'Sorry, I had trouble reading your notes right now.';
  }
};

export function isProxyEnabled(): boolean {
  return hasProxy();
}
