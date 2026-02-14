import {
  DeviceSession,
  Note,
  SyncBootstrapState,
  SyncConflict,
  SyncOp,
  SyncPullResponse,
  SyncPushResponse,
} from '../types';
import { apiFetch } from './apiClient';

export type SyncServiceError = Error & {
  code?: string;
  retryable?: boolean;
  status?: number;
  cause?: string;
  retryAfterMs?: number | null;
  retryAfterSeconds?: number | null;
};

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

function parsePayloadRetryAfterMs(payload: any): number | null {
  const retryAfterMs = payload?.error?.retryAfterMs;
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.floor(retryAfterMs);
  }

  const retryAfterSeconds = payload?.error?.retryAfterSeconds;
  if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.floor(retryAfterSeconds * 1000);
  }

  return null;
}

function mapError(response: Response, payload: any): SyncServiceError {
  const status = response.status;
  const message = payload?.error?.message || `Request failed with ${status}`;
  const error = new Error(message) as SyncServiceError;
  error.code = payload?.error?.code || 'UNKNOWN';
  error.retryable = !!payload?.error?.retryable;
  error.status = status;
  error.cause = typeof payload?.error?.cause === 'string' ? payload.error.cause : undefined;
  error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? parsePayloadRetryAfterMs(payload);
  error.retryAfterSeconds =
    typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs)
      ? Math.max(0, Math.ceil(error.retryAfterMs / 1000))
      : null;
  return error;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function fetchNotesSnapshot(includeDeleted = true): Promise<{ notes: Note[]; cursor: number }> {
  const response = await apiFetch(`/api/v2/notes?includeDeleted=${includeDeleted ? 'true' : 'false'}`);
  const payload = await readJson<{ notes: Note[]; cursor: number }>(response);
  if (!response.ok) throw mapError(response, payload);
  return payload;
}

export async function pullSyncChanges(cursor: number): Promise<SyncPullResponse> {
  const response = await apiFetch(`/api/v2/sync/pull?cursor=${encodeURIComponent(String(cursor))}`);
  const payload = await readJson<SyncPullResponse>(response);
  if (!response.ok) throw mapError(response, payload);
  return payload;
}

export async function pushSyncOps(operations: SyncOp[]): Promise<SyncPushResponse> {
  const response = await apiFetch('/api/v2/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations }),
  });
  const payload = await readJson<SyncPushResponse>(response);
  if (!response.ok) throw mapError(response, payload);
  return payload;
}

export async function bootstrapSync(notes: Note[], sourceFingerprint: string): Promise<SyncBootstrapState> {
  const response = await apiFetch('/api/v2/sync/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, sourceFingerprint }),
  });

  const payload = await readJson<SyncBootstrapState>(response);
  if (!response.ok) throw mapError(response, payload);
  return payload;
}

export async function listDevices(): Promise<{ devices: DeviceSession[]; currentDeviceId: string }> {
  const response = await apiFetch('/api/v2/devices');
  const payload = await readJson<{ devices: DeviceSession[]; currentDeviceId: string }>(response);
  if (!response.ok) throw mapError(response, payload);
  return payload;
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const response = await apiFetch(`/api/v2/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST',
  });
  const payload = await readJson<{ ok: boolean }>(response);
  if (!response.ok) throw mapError(response, payload);
}

export function openSyncEventStream(
  onCursor: (cursor: number) => void,
  onError: () => void,
  onOpen?: () => void
): () => void {
  const BASE_RECONNECT_MS = 1_000;
  const MAX_RECONNECT_MS = 30_000;
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let closed = false;
  let reconnectAttempts = 0;

  const nextReconnectMs = () => {
    const exp = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * Math.pow(2, reconnectAttempts));
    reconnectAttempts += 1;
    return Math.min(MAX_RECONNECT_MS, exp + Math.floor(Math.random() * 250));
  };

  const scheduleReconnect = (retryAfterMs?: number | null) => {
    if (closed || reconnectTimer !== null) return;
    const delay = retryAfterMs ?? nextReconnectMs();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    try {
      const ticketResponse = await apiFetch('/api/v2/events/ticket', {
        method: 'POST',
      });
      if (!ticketResponse.ok) {
        onError();
        const retryAfterMs = parseRetryAfterMs(ticketResponse.headers.get('retry-after'));
        if (retryAfterMs !== null) {
          scheduleReconnect(Math.min(MAX_RECONNECT_MS, Math.max(BASE_RECONNECT_MS, retryAfterMs)));
        } else {
          scheduleReconnect();
        }
        return;
      }
    } catch {
      onError();
      scheduleReconnect();
      return;
    }

    if (closed) return;

    source = new EventSource('/api/v2/events', { withCredentials: true });
    source.onopen = () => {
      reconnectAttempts = 0;
      onOpen?.();
    };
    source.addEventListener('sync', event => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { cursor?: number };
        if (typeof data.cursor === 'number') {
          onCursor(data.cursor);
        }
      } catch {
        // Ignore malformed events.
      }
    });

    source.onerror = () => {
      source?.close();
      source = null;
      onError();
      scheduleReconnect();
    };
  };

  void connect();

  return () => {
    closed = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    source?.close();
  };
}

export function createSyncUpsert(note: Note): SyncOp {
  return {
    requestId: crypto.randomUUID(),
    op: 'upsert',
    noteId: note.id,
    baseVersion: Math.max(0, (note.version || 1) - 1),
    note: {
      ...note,
      updatedAt: note.updatedAt || Date.now(),
      version: note.version || 1,
    },
  };
}

export function createSyncDelete(noteId: string, baseVersion: number): SyncOp {
  return {
    requestId: crypto.randomUUID(),
    op: 'delete',
    noteId,
    baseVersion,
  };
}

export function hasConflicts(response: SyncPushResponse): response is SyncPushResponse & { conflicts: SyncConflict[] } {
  return Array.isArray(response.conflicts) && response.conflicts.length > 0;
}
