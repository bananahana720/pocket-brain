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
let hubInitStarted = false;
let subscriberReady = false;
let publisherReady = true;
let distributedFanoutAvailable = false;
let degradedSinceTs: number | null = null;
let totalDegradedMs = 0;
let degradedTransitions = 0;
let degradedReason: RealtimeDegradedReason | null = 'NOT_INITIALIZED';

type RealtimeDegradedReason =
  | 'NOT_INITIALIZED'
  | 'SUBSCRIBER_CONNECT_FAILED'
  | 'SUBSCRIBER_CLOSE'
  | 'SUBSCRIBER_END'
  | 'SUBSCRIBER_RECONNECTING'
  | 'SUBSCRIBER_ERROR'
  | 'PUBLISH_FAILED';

function markRealtimeHealthy(now = Date.now()): void {
  distributedFanoutAvailable = hubInitStarted && subscriberReady && publisherReady;
  if (!distributedFanoutAvailable) {
    return;
  }
  degradedReason = null;
  if (degradedSinceTs !== null) {
    totalDegradedMs += Math.max(0, now - degradedSinceTs);
    degradedSinceTs = null;
  }
}

function markRealtimeDegraded(reason: RealtimeDegradedReason, now = Date.now()): void {
  distributedFanoutAvailable = false;
  degradedReason = reason;
  if (degradedSinceTs === null) {
    degradedSinceTs = now;
    degradedTransitions += 1;
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
    subscriberReady = true;
    markRealtimeHealthy();
  });
  subscriber.on('close', () => {
    subscriberReady = false;
    markRealtimeDegraded('SUBSCRIBER_CLOSE');
  });
  subscriber.on('end', () => {
    subscriberReady = false;
    markRealtimeDegraded('SUBSCRIBER_END');
  });
  subscriber.on('reconnecting', () => {
    subscriberReady = false;
    markRealtimeDegraded('SUBSCRIBER_RECONNECTING');
  });
  subscriber.on('error', () => {
    subscriberReady = false;
    markRealtimeDegraded('SUBSCRIBER_ERROR');
  });
}

export async function initRealtimeHub(): Promise<{ distributedFanoutAvailable: boolean }> {
  if (hubInitStarted) {
    return { distributedFanoutAvailable };
  }
  hubInitStarted = true;

  try {
    const sub = redis.duplicate();
    bindSubscriberLifecycle(sub);
    await sub.connect();
    await sub.subscribe(CHANNEL);
    subscriberReady = true;
    markRealtimeHealthy();
    sub.on('message', (_channel: string, message: string) => {
      const parsed = parsePayload(message);
      if (!parsed) return;
      emitter.emit('sync', parsed);
    });
  } catch {
    // Local emitter only fallback.
    subscriberReady = false;
    markRealtimeDegraded('SUBSCRIBER_CONNECT_FAILED');
  }

  return { distributedFanoutAvailable };
}

export function getRealtimeHubStatus(): {
  initializationState: 'not-initialized' | 'initialized';
  distributedFanoutAvailable: boolean;
  subscriberReady: boolean;
  publisherReady: boolean;
  degradedReason: RealtimeDegradedReason | null;
  degradedSinceTs: number | null;
  currentDegradedForMs: number;
  totalDegradedMs: number;
  degradedTransitions: number;
} {
  const now = Date.now();
  const effectiveDegradedSinceTs = distributedFanoutAvailable ? null : degradedSinceTs;
  const currentDegradedForMs = effectiveDegradedSinceTs === null ? 0 : Math.max(0, now - effectiveDegradedSinceTs);
  return {
    initializationState: hubInitStarted ? 'initialized' : 'not-initialized',
    distributedFanoutAvailable,
    subscriberReady,
    publisherReady,
    degradedReason: distributedFanoutAvailable ? null : degradedReason,
    degradedSinceTs: effectiveDegradedSinceTs,
    currentDegradedForMs,
    totalDegradedMs: totalDegradedMs + currentDegradedForMs,
    degradedTransitions,
  };
}

export async function publishSyncEvent(event: SyncEvent): Promise<void> {
  emitter.emit('sync', event);

  try {
    await redis.publish(CHANNEL, JSON.stringify(event));
    publisherReady = true;
    markRealtimeHealthy();
  } catch {
    // Optional cross-instance propagation.
    publisherReady = false;
    markRealtimeDegraded('PUBLISH_FAILED');
  }
}

export function subscribeSyncEvents(listener: (event: SyncEvent) => void): () => void {
  emitter.on('sync', listener);
  return () => emitter.off('sync', listener);
}
