import { EventEmitter } from 'node:events';
import { redis } from '../db/client.js';
import type { Redis } from 'ioredis';

export interface SyncEvent {
  userId: string;
  cursor: number;
  type: 'sync';
  emittedAt: number;
}

const CHANNEL = 'pocketbrain:sync';
const emitter = new EventEmitter();
let subscriberReady = false;
let distributedFanoutAvailable = false;
let degradedSinceTs: number | null = null;
let totalDegradedMs = 0;

function markRealtimeHealthy(now = Date.now()): void {
  distributedFanoutAvailable = true;
  if (degradedSinceTs !== null) {
    totalDegradedMs += Math.max(0, now - degradedSinceTs);
    degradedSinceTs = null;
  }
}

function markRealtimeDegraded(now = Date.now()): void {
  distributedFanoutAvailable = false;
  if (degradedSinceTs === null) {
    degradedSinceTs = now;
  }
}

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

function bindSubscriberLifecycle(subscriber: Redis): void {
  subscriber.on('ready', () => {
    markRealtimeHealthy();
  });
  subscriber.on('close', () => {
    markRealtimeDegraded();
  });
  subscriber.on('end', () => {
    markRealtimeDegraded();
  });
  subscriber.on('reconnecting', () => {
    markRealtimeDegraded();
  });
  subscriber.on('error', () => {
    markRealtimeDegraded();
  });
}

export async function initRealtimeHub(): Promise<{ distributedFanoutAvailable: boolean }> {
  if (subscriberReady) {
    return { distributedFanoutAvailable };
  }
  subscriberReady = true;

  try {
    const sub = redis.duplicate();
    bindSubscriberLifecycle(sub);
    await sub.connect();
    await sub.subscribe(CHANNEL);
    markRealtimeHealthy();
    sub.on('message', (_channel: string, message: string) => {
      const parsed = parsePayload(message);
      if (!parsed) return;
      emitter.emit('sync', parsed);
    });
  } catch {
    // Local emitter only fallback.
    markRealtimeDegraded();
  }

  return { distributedFanoutAvailable };
}

export function getRealtimeHubStatus(): {
  distributedFanoutAvailable: boolean;
  degradedSinceTs: number | null;
  currentDegradedForMs: number;
  totalDegradedMs: number;
} {
  const now = Date.now();
  const currentDegradedForMs = degradedSinceTs === null ? 0 : Math.max(0, now - degradedSinceTs);
  return {
    distributedFanoutAvailable,
    degradedSinceTs,
    currentDegradedForMs,
    totalDegradedMs: totalDegradedMs + currentDegradedForMs,
  };
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
