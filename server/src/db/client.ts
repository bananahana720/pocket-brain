import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
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
