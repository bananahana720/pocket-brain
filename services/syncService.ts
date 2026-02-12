import { DeviceSession, Note, SyncBootstrapState, SyncConflict, SyncOp, SyncPushResponse } from '../types';
import { apiFetch, getAuthToken } from './apiClient';

function mapError(status: number, payload: any): Error {
  const message = payload?.error?.message || `Request failed with ${status}`;
  const error = new Error(message) as Error & { code?: string; retryable?: boolean; status?: number };
  error.code = payload?.error?.code || 'UNKNOWN';
  error.retryable = !!payload?.error?.retryable;
  error.status = status;
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
  if (!response.ok) throw mapError(response.status, payload);
  return payload;
}

export async function pullSyncChanges(cursor: number): Promise<{
  changes: Array<{ cursor: number; op: 'upsert' | 'delete'; note: Note; requestId: string }>;
  nextCursor: number;
}> {
  const response = await apiFetch(`/api/v2/sync/pull?cursor=${encodeURIComponent(String(cursor))}`);
  const payload = await readJson<{ changes: Array<{ cursor: number; op: 'upsert' | 'delete'; note: Note; requestId: string }>; nextCursor: number }>(
    response
  );
  if (!response.ok) throw mapError(response.status, payload);
  return payload;
}

export async function pushSyncOps(operations: SyncOp[]): Promise<SyncPushResponse> {
  const response = await apiFetch('/api/v2/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations }),
  });
  const payload = await readJson<SyncPushResponse>(response);
  if (!response.ok) throw mapError(response.status, payload);
  return payload;
}

export async function bootstrapSync(notes: Note[], sourceFingerprint: string): Promise<SyncBootstrapState> {
  const response = await apiFetch('/api/v2/sync/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, sourceFingerprint }),
  });

  const payload = await readJson<SyncBootstrapState>(response);
  if (!response.ok) throw mapError(response.status, payload);
  return payload;
}

export async function listDevices(): Promise<{ devices: DeviceSession[]; currentDeviceId: string }> {
  const response = await apiFetch('/api/v2/devices');
  const payload = await readJson<{ devices: DeviceSession[]; currentDeviceId: string }>(response);
  if (!response.ok) throw mapError(response.status, payload);
  return payload;
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const response = await apiFetch(`/api/v2/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST',
  });
  const payload = await readJson<{ ok: boolean }>(response);
  if (!response.ok) throw mapError(response.status, payload);
}

export function openSyncEventStream(
  onCursor: (cursor: number) => void,
  onError: () => void
): () => void {
  let source: EventSource | null = null;
  let closed = false;

  void (async () => {
    const token = await getAuthToken();
    if (closed) return;

    const streamUrl = token ? `/api/v2/events?token=${encodeURIComponent(token)}` : '/api/v2/events';
    source = new EventSource(streamUrl, { withCredentials: true });

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
      onError();
    };
  })();

  return () => {
    closed = true;
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
