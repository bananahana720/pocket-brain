import { GoogleGenAI, Type } from "@google/genai";
import { Note, NoteType, AIAnalysisResult } from "../types";

// --- Provider abstraction ---
// Gemini uses @google/genai SDK. OpenRouter uses fetch with OpenAI-compatible format.

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_MODEL = 'google/gemini-2.5-flash';

type Provider = 'gemini' | 'openrouter';

function getProvider(): Provider | null {
  if (OPENROUTER_KEY) return 'openrouter';
  if (GEMINI_KEY) return 'gemini';
  console.warn("API Key not found. Set GEMINI_API_KEY or OPENROUTER_API_KEY in .env.local");
  return null;
}

function getGeminiClient(): GoogleGenAI | null {
  if (!GEMINI_KEY) return null;
  return new GoogleGenAI({ apiKey: GEMINI_KEY });
}

// --- OpenRouter fetch helper (OpenAI-compatible) ---

async function openRouterChat(
  prompt: string,
  jsonSchema?: Record<string, unknown>
): Promise<string | null> {
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
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
      'X-Title': 'PocketBrain',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

// --- Shared prompt builders ---

function buildAnalyzePrompt(content: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `Analyze the following note content. Classify it as a NOTE, TASK, or IDEA.
Generate a short, punchy title (max 5 words).
Generate up to 3 relevant tags.

Also extract a due date if one is mentioned or implied (return as ISO date string YYYY-MM-DD, or null if none).
Today's date is ${today}. Examples: "call dentist Thursday" → next Thursday's date, "due tomorrow" → tomorrow's date.

Also extract priority if implied: "urgent" for urgent/critical/ASAP items, "normal" for standard items, "low" for low-priority/someday items. Return null if no priority is implied.
Examples: "URGENT: fix bug" → urgent, "maybe someday learn piano" → low.

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

// --- Shared response parsers ---

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

// --- JSON schema for OpenRouter structured output ---

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

// ============================================================
// Public API — each function handles both providers internally
// ============================================================

/**
 * Analyzes a raw note to extract a title, tags, and category.
 */
export const analyzeNote = async (content: string): Promise<AIAnalysisResult | null> => {
  const provider = getProvider();
  if (!provider) return null;

  try {
    if (provider === 'openrouter') {
      const text = await openRouterChat(buildAnalyzePrompt(content), ANALYSIS_SCHEMA);
      if (!text) return null;
      return parseAnalysisResult(JSON.parse(text));
    }

    // Gemini path
    const ai = getGeminiClient()!;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: buildAnalyzePrompt(content),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            type: { type: Type.STRING, enum: ["NOTE", "TASK", "IDEA"] },
            dueDate: { type: Type.STRING, nullable: true },
            priority: { type: Type.STRING, enum: ["urgent", "normal", "low"], nullable: true },
          },
          required: ["title", "tags", "type"],
        },
      },
    });

    const text = response.text;
    if (!text) return null;
    return parseAnalysisResult(JSON.parse(text));
  } catch (error) {
    console.error("Error analyzing note:", error);
    return null;
  }
};

/**
 * Takes a brain dump and splits it into multiple distinct notes/tasks
 */
export const processBatchEntry = async (content: string): Promise<AIAnalysisResult[]> => {
  const provider = getProvider();
  if (!provider) return [];

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

    // Gemini path
    const ai = getGeminiClient()!;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: buildBatchPrompt(content),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              content: { type: Type.STRING, description: "The extracted content for this specific item" },
              title: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              type: { type: Type.STRING, enum: ["NOTE", "TASK", "IDEA"] },
            },
            required: ["content", "title", "tags", "type"],
          }
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
    console.error("Error processing batch:", error);
    return [];
  }
};

/**
 * Generates a short AI daily briefing based on today's relevant notes.
 */
export const generateDailyBrief = async (notes: Note[]): Promise<string | null> => {
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
  if (relevantNotes.length === 0) {
    return null;
  }

  const provider = getProvider();
  if (!provider) return "I need an API key to generate your daily brief.";

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
      const text = await openRouterChat(prompt);
      return text || "Couldn't generate your daily brief right now.";
    }

    const ai = getGeminiClient()!;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "Couldn't generate your daily brief right now.";
  } catch (error) {
    console.error("Error generating daily brief:", error);
    return "Sorry, I had trouble generating your daily brief.";
  }
};

/**
 * Semantic search / Q&A over notes
 */
export const askMyNotes = async (query: string, notes: Note[]): Promise<string> => {
  const provider = getProvider();
  if (!provider) return "I need an API key to help you search.";

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
      const text = await openRouterChat(prompt);
      return text || "No answer generated.";
    }

    const ai = getGeminiClient()!;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "No answer generated.";
  } catch (error) {
    console.error("Error searching notes:", error);
    return "Sorry, I had trouble reading your notes right now.";
  }
};
