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

export async function checkRedisReady(): Promise<{
  ok: boolean;
  status: string;
}> {
  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }

    const pong = await redis.ping();
    return {
      ok: pong === 'PONG',
      status: redis.status,
    };
  } catch {
    return {
      ok: false,
      status: redis.status,
    };
  }
}
