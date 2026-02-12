import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function buildMetricsApp(): Promise<FastifyInstance> {
  vi.doMock('../src/config/env.js', () => ({
    env: {
      REQUIRE_REDIS_FOR_READY: false,
    },
  }));

  vi.doMock('../src/db/client.js', () => ({
    checkDatabaseReady: vi.fn().mockResolvedValue(true),
    checkRedisReady: vi.fn().mockResolvedValue({
      ok: false,
      status: 'end',
    }),
  }));

  vi.doMock('../src/realtime/hub.js', () => ({
    getRealtimeHubStatus: () => ({
      distributedFanoutAvailable: false,
      degradedSinceTs: Date.now() - 4_000,
      currentDegradedForMs: 4_000,
      totalDegradedMs: 25_000,
    }),
  }));

  vi.doMock('../src/services/maintenance.js', () => ({
    getMaintenanceHealth: () => ({
      cyclesRun: 1,
      cyclesFailed: 0,
      lastCompletedAt: Date.now(),
      lastFailedAt: null,
      lastResult: {
        prunedTombstones: 1,
        prunedNoteChanges: 2,
        removedIdempotencyKeys: 3,
      },
      lastErrorMessage: null,
    }),
  }));

  vi.doMock('../src/services/sync.js', () => ({
    getSyncHealthMetrics: () => ({
      pullRequests: 12,
      pullResetsRequired: 3,
      lastResetAt: Date.now(),
      lastResetCursor: 21,
      lastResetOldestAvailableCursor: 33,
      lastResetLatestCursor: 34,
      noteChangesPruneRuns: 2,
      noteChangesPrunedTotal: 44,
      lastNoteChangesPrunedAt: Date.now(),
      lastNoteChangesPrunedCount: 7,
    }),
  }));

  const { registerHealthRoutes } = await import('../src/routes/health.js');
  const app = Fastify();
  await registerHealthRoutes(app);
  return app;
}

describe('metrics route', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('emits scrape-friendly prometheus counters and gauges', async () => {
    const app = await buildMetricsApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toContain('pocketbrain_sync_cursor_resets_total 3');
      expect(response.body).toContain('pocketbrain_note_changes_pruned_total 44');
      expect(response.body).toContain('pocketbrain_realtime_fallback_active 1');
      expect(response.body).toContain('pocketbrain_realtime_fallback_dwell_seconds 4');
      expect(response.body).toContain('pocketbrain_realtime_fallback_dwell_seconds_total 25');
    } finally {
      await app.close();
    }
  });
});
