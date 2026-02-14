import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.PG_POOL_CONNECTION_TIMEOUT_MS,
});

export const db = drizzle(pool, { schema });

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});
redis.on('error', () => {
  // Optional dependency; callers handle degraded mode.
});

interface RedisReadyTelemetryState {
  checksTotal: number;
  failuresTotal: number;
  timeoutsTotal: number;
  consecutiveFailures: number;
  lastCheckAt: number | null;
  lastCheckDurationMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorMessage: string | null;
  degradedSinceTs: number | null;
  totalDegradedMs: number;
  degradedTransitions: number;
}

export interface RedisReadyTelemetry {
  checksTotal: number;
  failuresTotal: number;
  timeoutsTotal: number;
  consecutiveFailures: number;
  lastCheckAt: number | null;
  lastCheckDurationMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorMessage: string | null;
  degraded: boolean;
  degradedSinceTs: number | null;
  degradedForMs: number;
  totalDegradedMs: number;
  degradedTransitions: number;
}

export interface RedisReadyState extends RedisReadyTelemetry {
  ok: boolean;
  status: string;
}

const redisReadyTelemetryState: RedisReadyTelemetryState = {
  checksTotal: 0,
  failuresTotal: 0,
  timeoutsTotal: 0,
  consecutiveFailures: 0,
  lastCheckAt: null,
  lastCheckDurationMs: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastErrorMessage: null,
  degradedSinceTs: null,
  totalDegradedMs: 0,
  degradedTransitions: 0,
};

const REDIS_READY_TIMEOUT_MESSAGE = 'redis readiness timeout';

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'unknown redis readiness error';
}

function markRedisReadyHealthy(now = Date.now()): void {
  redisReadyTelemetryState.consecutiveFailures = 0;
  redisReadyTelemetryState.lastSuccessAt = now;
  redisReadyTelemetryState.lastErrorMessage = null;
  if (redisReadyTelemetryState.degradedSinceTs !== null) {
    redisReadyTelemetryState.totalDegradedMs += Math.max(0, now - redisReadyTelemetryState.degradedSinceTs);
    redisReadyTelemetryState.degradedSinceTs = null;
  }
}

function markRedisReadyDegraded(error: unknown, now = Date.now()): void {
  redisReadyTelemetryState.failuresTotal += 1;
  redisReadyTelemetryState.consecutiveFailures += 1;
  redisReadyTelemetryState.lastFailureAt = now;
  redisReadyTelemetryState.lastErrorMessage = resolveErrorMessage(error);
  if (redisReadyTelemetryState.degradedSinceTs === null) {
    redisReadyTelemetryState.degradedSinceTs = now;
    redisReadyTelemetryState.degradedTransitions += 1;
  }
}

function getRedisReadyTelemetrySnapshot(now = Date.now()): RedisReadyTelemetry {
  const degradedForMs =
    redisReadyTelemetryState.degradedSinceTs === null ? 0 : Math.max(0, now - redisReadyTelemetryState.degradedSinceTs);

  return {
    checksTotal: redisReadyTelemetryState.checksTotal,
    failuresTotal: redisReadyTelemetryState.failuresTotal,
    timeoutsTotal: redisReadyTelemetryState.timeoutsTotal,
    consecutiveFailures: redisReadyTelemetryState.consecutiveFailures,
    lastCheckAt: redisReadyTelemetryState.lastCheckAt,
    lastCheckDurationMs: redisReadyTelemetryState.lastCheckDurationMs,
    lastSuccessAt: redisReadyTelemetryState.lastSuccessAt,
    lastFailureAt: redisReadyTelemetryState.lastFailureAt,
    lastErrorMessage: redisReadyTelemetryState.lastErrorMessage,
    degraded: redisReadyTelemetryState.degradedSinceTs !== null,
    degradedSinceTs: redisReadyTelemetryState.degradedSinceTs,
    degradedForMs,
    totalDegradedMs: redisReadyTelemetryState.totalDegradedMs + degradedForMs,
    degradedTransitions: redisReadyTelemetryState.degradedTransitions,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  if (timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then(value => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function isRedisReadyTimeout(error: unknown): boolean {
  return resolveErrorMessage(error) === REDIS_READY_TIMEOUT_MESSAGE;
}

export async function connectInfra(): Promise<void> {
  await pool.query('select 1');
  try {
    await redis.connect();
  } catch {
    // Realtime falls back to in-process emitter when Redis is unavailable.
  }
}

export async function closeInfra(): Promise<void> {
  await Promise.allSettled([pool.end(), redis.quit()]);
}

export async function checkDatabaseReady(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

export async function checkRedisReady(): Promise<RedisReadyState> {
  const checkStartedAt = Date.now();
  redisReadyTelemetryState.checksTotal += 1;
  const timeoutMs = env.REDIS_READY_TIMEOUT_MS;

  try {
    if (redis.status === 'wait') {
      await withTimeout(redis.connect(), timeoutMs, REDIS_READY_TIMEOUT_MESSAGE);
    }

    const pong = await withTimeout(redis.ping(), timeoutMs, REDIS_READY_TIMEOUT_MESSAGE);
    const now = Date.now();
    redisReadyTelemetryState.lastCheckAt = now;
    redisReadyTelemetryState.lastCheckDurationMs = Math.max(0, now - checkStartedAt);
    if (pong === 'PONG') {
      markRedisReadyHealthy(now);
    } else {
      markRedisReadyDegraded('unexpected redis ping response', now);
    }

    return {
      ok: pong === 'PONG',
      status: redis.status,
      ...getRedisReadyTelemetrySnapshot(now),
    };
  } catch (error) {
    const now = Date.now();
    redisReadyTelemetryState.lastCheckAt = now;
    redisReadyTelemetryState.lastCheckDurationMs = Math.max(0, now - checkStartedAt);
    if (isRedisReadyTimeout(error)) {
      redisReadyTelemetryState.timeoutsTotal += 1;
    }
    markRedisReadyDegraded(error, now);
    return {
      ok: false,
      status: redis.status,
      ...getRedisReadyTelemetrySnapshot(now),
    };
  }
}

export function getRedisReadyTelemetry(): RedisReadyTelemetry {
  return getRedisReadyTelemetrySnapshot();
}
