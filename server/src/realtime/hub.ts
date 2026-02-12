import { EventEmitter } from 'node:events';
import { redis } from '../db/client.js';

export interface SyncEvent {
  userId: string;
  cursor: number;
  type: 'sync';
  emittedAt: number;
}

const CHANNEL = 'pocketbrain:sync';
const emitter = new EventEmitter();
let subscriberReady = false;

function parsePayload(payload: string): SyncEvent | null {
  try {
    const parsed = JSON.parse(payload) as Partial<SyncEvent>;
    if (
      parsed &&
      parsed.type === 'sync' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.cursor === 'number' &&
      typeof parsed.emittedAt === 'number'
    ) {
      return parsed as SyncEvent;
    }
    return null;
  } catch {
    return null;
  }
}

export async function initRealtimeHub(): Promise<void> {
  if (subscriberReady) return;
  subscriberReady = true;

  try {
    const sub = redis.duplicate();
    await sub.connect();
    await sub.subscribe(CHANNEL);
    sub.on('message', (_channel: string, message: string) => {
      const parsed = parsePayload(message);
      if (!parsed) return;
      emitter.emit('sync', parsed);
    });
  } catch {
    // Local emitter only fallback.
  }
}

export async function publishSyncEvent(event: SyncEvent): Promise<void> {
  emitter.emit('sync', event);

  try {
    await redis.publish(CHANNEL, JSON.stringify(event));
  } catch {
    // Optional cross-instance propagation.
  }
}

export function subscribeSyncEvents(listener: (event: SyncEvent) => void): () => void {
  emitter.on('sync', listener);
  return () => emitter.off('sync', listener);
}
