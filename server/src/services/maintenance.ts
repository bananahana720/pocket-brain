import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { pruneNoteChanges, pruneTombstones } from './sync.js';

interface MaintenanceLogger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

interface MaintenanceHealth {
  cyclesRun: number;
  cyclesFailed: number;
  lastCompletedAt: number | null;
  lastFailedAt: number | null;
  lastResult: {
    prunedTombstones: number;
    prunedNoteChanges: number;
    removedIdempotencyKeys: number;
  } | null;
  lastErrorMessage: string | null;
}

const maintenanceHealth: MaintenanceHealth = {
  cyclesRun: 0,
  cyclesFailed: 0,
  lastCompletedAt: null,
  lastFailedAt: null,
  lastResult: null,
  lastErrorMessage: null,
};

export async function runMaintenanceCycle(): Promise<{
  prunedTombstones: number;
  prunedNoteChanges: number;
  removedIdempotencyKeys: number;
}> {
  const prunedTombstones = await pruneTombstones(env.TOMBSTONE_RETENTION_MS);
  const prunedNoteChanges = await pruneNoteChanges(env.NOTE_CHANGES_RETENTION_MS);
  const removed = await db
    .delete(idempotencyKeys)
    .where(sql`${idempotencyKeys.expiresAt} < ${Date.now()}`)
    .returning({ requestId: idempotencyKeys.requestId });

  return {
    prunedTombstones,
    prunedNoteChanges,
    removedIdempotencyKeys: removed.length,
  };
}

export function getMaintenanceHealth(): MaintenanceHealth {
  return {
    ...maintenanceHealth,
    ...(maintenanceHealth.lastResult ? { lastResult: { ...maintenanceHealth.lastResult } } : {}),
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
      maintenanceHealth.cyclesRun += 1;
      maintenanceHealth.lastCompletedAt = Date.now();
      maintenanceHealth.lastResult = result;
      maintenanceHealth.lastErrorMessage = null;
      logger.info({ maintenance: result }, 'maintenance cycle completed');
    } catch (error) {
      maintenanceHealth.cyclesFailed += 1;
      maintenanceHealth.lastFailedAt = Date.now();
      maintenanceHealth.lastErrorMessage = error instanceof Error ? error.message : 'unknown maintenance error';
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
