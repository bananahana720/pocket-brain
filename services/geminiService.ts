import { GoogleGenAI, Type } from '@google/genai';
import { AIAnalysisResult, AIAuthState, AIProvider, Note, NoteType } from '../types';

const OPENROUTER_MODEL = 'google/gemini-2.5-flash';
const USE_AI_PROXY = !!(import.meta.env?.PROD || import.meta.env?.VITE_USE_AI_PROXY === 'true');
const PROXY_TIMEOUT_MS = 12000;
const PROXY_RETRIES = 2;

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

function getDevGeminiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

function getDevOpenRouterKey(): string {
  return process.env.OPENROUTER_API_KEY || '';
}

function getProvider(): Provider | null {
  const openRouter = getDevOpenRouterKey();
  const gemini = getDevGeminiKey();
  if (openRouter) return 'openrouter';
  if (gemini) return 'gemini';
  return null;
}

function getGeminiClient(): GoogleGenAI | null {
  const key = getDevGeminiKey();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
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
      const response = await fetch(url, {
        ...init,
        credentials: 'include',
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
  return proxyJson<T>(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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

function hasProxy(): boolean {
  return USE_AI_PROXY;
}

export async function getAIAuthStatus(options?: RequestOptions): Promise<AIAuthState> {
  if (!hasProxy()) {
    const provider = getProvider();
    return {
      connected: !!provider,
      ...(provider ? { provider } : {}),
      ...(provider ? { expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 } : {}),
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

  const provider = getProvider();
  if (!provider) {
    throw new AIServiceError('No API key configured for AI analysis.', 'AUTH_REQUIRED', false);
  }

  try {
    if (provider === 'openrouter') {
      const text = await openRouterChat(buildAnalyzePrompt(content), ANALYSIS_SCHEMA);
      if (!text) return null;
      return parseAnalysisResult(JSON.parse(text));
    }

    const ai = getGeminiClient();
    if (!ai) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);

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
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError('Error analyzing note.', 'PROVIDER_UNAVAILABLE', true);
  }
};

export const processBatchEntry = async (
  content: string,
  options?: RequestOptions
): Promise<AIAnalysisResult[]> => {
  if (hasProxy()) {
    const payload = await proxyPost<{ results: AIAnalysisResult[] }>('/api/v1/ai/batch', { content }, options);
    return payload.results;
  }

  const provider = getProvider();
  if (!provider) {
    throw new AIServiceError('No API key configured for batch processing.', 'AUTH_REQUIRED', false);
  }

  try {
    if (provider === 'openrouter') {
      const text = await openRouterChat(buildBatchPrompt(content), BATCH_SCHEMA);
      if (!text) return [];
      const parsed = JSON.parse(text);
      const items = parsed.items || parsed;
      return (items as Record<string, unknown>[]).map(r => ({
        content: r.content as string,
        title: r.title as string,
        tags: r.tags as string[],
        type: parseNoteType(r.type as string),
      }));
    }

    const ai = getGeminiClient();
    if (!ai) throw new AIServiceError('Gemini key missing.', 'AUTH_REQUIRED', false);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: buildBatchPrompt(content),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
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
    });

    const text = response.text;
    if (!text) return [];

    const results = JSON.parse(text);
    return results.map((r: { content: string; title: string; tags: string[]; type: string }) => ({
      content: r.content,
      title: r.title,
      tags: r.tags,
      type: parseNoteType(r.type),
    }));
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError('Error processing batch.', 'PROVIDER_UNAVAILABLE', true);
  }
};

export const generateDailyBrief = async (notes: Note[], options?: RequestOptions): Promise<string | null> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

  const activeNotes = notes.filter(n => !n.isArchived);

  const overdueNotes = activeNotes.filter(
    n => n.dueDate && n.dueDate < startOfToday && !n.isCompleted
  );
  const dueTodayNotes = activeNotes.filter(
    n => n.dueDate && n.dueDate >= startOfToday && n.dueDate < endOfToday && !n.isCompleted
  );
  const capturedTodayNotes = activeNotes.filter(
    n => n.createdAt >= startOfToday && n.createdAt < endOfToday
  );

  const relevantNotes = [...overdueNotes, ...dueTodayNotes, ...capturedTodayNotes];
  if (relevantNotes.length === 0) return null;

  if (hasProxy()) {
    const payload = await proxyPost<{ result: string | null }>('/api/v1/ai/daily-brief', { notes }, options);
    return payload.result;
  }

  const provider = getProvider();
  if (!provider) {
    return 'I need an API key to generate your daily brief.';
  }

  const formatNote = (n: Note) => {
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
    if (provider === 'openrouter') {
      return (await openRouterChat(prompt)) || "Couldn't generate your daily brief right now.";
    }

    const ai = getGeminiClient();
    if (!ai) return "Couldn't generate your daily brief right now.";

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "Couldn't generate your daily brief right now.";
  } catch {
    return 'Sorry, I had trouble generating your daily brief.';
  }
};

export const askMyNotes = async (query: string, notes: Note[], options?: RequestOptions): Promise<string> => {
  if (hasProxy()) {
    const payload = await proxyPost<{ result: string }>('/api/v1/ai/search', { query, notes }, options);
    return payload.result;
  }

  const provider = getProvider();
  if (!provider) return 'I need an API key to help you search.';

  const relevantNotes = notes.slice(0, 50);

  const context = relevantNotes.map(n =>
    `[ID: ${n.id}] [${n.type}] [${n.isCompleted ? 'DONE' : 'OPEN'}] (${new Date(n.createdAt).toLocaleDateString()}) ${n.content}`
  ).join('\n---\n');

  const prompt = `You are a helpful personal assistant.
The user is asking a question about their notes.
Here is the user's question: "${query}"

Here are the user's notes:
${context}

Answer the question based ONLY on the notes provided.
If the answer isn't in the notes, say "I couldn't find that in your notes."
Be concise and friendly.`;

  try {
    if (provider === 'openrouter') {
      return (await openRouterChat(prompt)) || 'No answer generated.';
    }

    const ai = getGeminiClient();
    if (!ai) return 'No answer generated.';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || 'No answer generated.';
  } catch {
    return 'Sorry, I had trouble reading your notes right now.';
  }
};

export function isProxyEnabled(): boolean {
  return hasProxy();
}
