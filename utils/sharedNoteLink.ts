import { Note, NoteType } from '../types';

export interface SharedNotePayload {
  content: string;
  title?: string;
  type?: NoteType;
  tags?: string[];
  dueDate?: number;
  priority?: 'urgent' | 'normal' | 'low';
}

const MAX_SHARED_CONTENT_LENGTH = 500;
const MAX_SHARED_TITLE_LENGTH = 80;
const MAX_SHARED_TAGS = 5;
const MAX_SHARED_TAG_LENGTH = 24;

const VALID_TYPES = new Set<NoteType>([NoteType.NOTE, NoteType.TASK, NoteType.IDEA]);
const VALID_PRIORITIES = new Set(['urgent', 'normal', 'low']);

function encodeUtf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlToUtf8(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizePayload(payload: Partial<SharedNotePayload>): SharedNotePayload | null {
  const content = payload.content?.trim();
  if (!content) return null;

  const normalized: SharedNotePayload = {
    content:
      content.length > MAX_SHARED_CONTENT_LENGTH
        ? `${content.slice(0, MAX_SHARED_CONTENT_LENGTH - 3)}...`
        : content,
  };

  const title = payload.title?.trim();
  if (title) {
    normalized.title =
      title.length > MAX_SHARED_TITLE_LENGTH
        ? `${title.slice(0, MAX_SHARED_TITLE_LENGTH - 3)}...`
        : title;
  }

  if (payload.type && VALID_TYPES.has(payload.type)) {
    normalized.type = payload.type;
  }

  if (Array.isArray(payload.tags) && payload.tags.length > 0) {
    const tags = payload.tags
      .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
      .filter(Boolean)
      .slice(0, MAX_SHARED_TAGS)
      .map(tag => (tag.length > MAX_SHARED_TAG_LENGTH ? tag.slice(0, MAX_SHARED_TAG_LENGTH) : tag));
    if (tags.length) normalized.tags = tags;
  }

  if (typeof payload.dueDate === 'number' && Number.isFinite(payload.dueDate) && payload.dueDate > 0) {
    normalized.dueDate = payload.dueDate;
  }

  if (payload.priority && VALID_PRIORITIES.has(payload.priority)) {
    normalized.priority = payload.priority;
  }

  return normalized;
}

export function encodeSharedNotePayload(note: Pick<Note, 'content' | 'title' | 'type' | 'tags' | 'dueDate' | 'priority'>): string | null {
  try {
    const normalized = normalizePayload(note);
    if (!normalized) return null;
    return encodeUtf8ToBase64Url(JSON.stringify(normalized));
  } catch {
    return null;
  }
}

export function decodeSharedNotePayload(value: string): SharedNotePayload | null {
  try {
    const decoded = decodeBase64UrlToUtf8(value);
    const parsed = JSON.parse(decoded) as Partial<SharedNotePayload>;
    return normalizePayload(parsed);
  } catch {
    return null;
  }
}
