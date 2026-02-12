import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { pruneTombstones } from './sync.js';

interface MaintenanceLogger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export async function runMaintenanceCycle(): Promise<{
  prunedTombstones: number;
  removedIdempotencyKeys: number;
}> {
  const prunedTombstones = await pruneTombstones(env.TOMBSTONE_RETENTION_MS);
  const removed = await db
    .delete(idempotencyKeys)
    .where(sql`${idempotencyKeys.expiresAt} < ${Date.now()}`)
    .returning({ requestId: idempotencyKeys.requestId });

  return {
    prunedTombstones,
    removedIdempotencyKeys: removed.length,
  };
}

export function startMaintenanceLoop(logger: MaintenanceLogger): () => void {
  let intervalHandle: NodeJS.Timeout | null = null;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;

    try {
      const result = await runMaintenanceCycle();
      logger.info({ maintenance: result }, 'maintenance cycle completed');
    } catch (error) {
      logger.error({ err: error }, 'maintenance cycle failed');
    } finally {
      running = false;
    }
  };

  void run();
  intervalHandle = setInterval(() => {
    void run();
  }, env.MAINTENANCE_INTERVAL_MS);

  return () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };
}
