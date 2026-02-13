import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function buildHealthApp(args: {
  requireRedisForReady: boolean;
  databaseOk: boolean;
  redisOk: boolean;
  redisStatus: string;
}): Promise<FastifyInstance> {
  vi.doMock('../src/config/env.js', () => ({
    env: {
      REQUIRE_REDIS_FOR_READY: args.requireRedisForReady,
    },
  }));

  vi.doMock('../src/db/client.js', () => ({
    checkDatabaseReady: vi.fn().mockResolvedValue(args.databaseOk),
    checkRedisReady: vi.fn().mockResolvedValue({
      ok: args.redisOk,
      status: args.redisStatus,
      checksTotal: 1,
      failuresTotal: args.redisOk ? 0 : 1,
      consecutiveFailures: args.redisOk ? 0 : 1,
      lastCheckAt: Date.now(),
      lastCheckDurationMs: 1,
      lastSuccessAt: args.redisOk ? Date.now() : null,
      lastFailureAt: args.redisOk ? null : Date.now(),
      lastErrorMessage: args.redisOk ? null : 'redis unavailable',
      degraded: !args.redisOk,
      degradedSinceTs: args.redisOk ? null : Date.now() - 1_000,
      degradedForMs: args.redisOk ? 0 : 1_000,
      totalDegradedMs: args.redisOk ? 0 : 5_000,
    }),
    getRedisReadyTelemetry: () => ({
      checksTotal: 1,
      failuresTotal: args.redisOk ? 0 : 1,
      consecutiveFailures: args.redisOk ? 0 : 1,
      lastCheckAt: Date.now(),
      lastCheckDurationMs: 1,
      lastSuccessAt: args.redisOk ? Date.now() : null,
      lastFailureAt: args.redisOk ? null : Date.now(),
      lastErrorMessage: args.redisOk ? null : 'redis unavailable',
      degraded: !args.redisOk,
      degradedSinceTs: args.redisOk ? null : Date.now() - 1_000,
      degradedForMs: args.redisOk ? 0 : 1_000,
      totalDegradedMs: args.redisOk ? 0 : 5_000,
    }),
  }));

  vi.doMock('../src/realtime/hub.js', () => ({
    getRealtimeHubStatus: () => ({
      initializationState: 'initialized',
      distributedFanoutAvailable: args.redisOk,
      subscriberReady: args.redisOk,
      publisherReady: args.redisOk,
      degradedReason: args.redisOk ? null : 'SUBSCRIBER_CONNECT_FAILED',
      degradedSinceTs: args.redisOk ? null : Date.now() - 1_000,
      currentDegradedForMs: args.redisOk ? 0 : 1_000,
      totalDegradedMs: args.redisOk ? 0 : 5_000,
      degradedTransitions: args.redisOk ? 0 : 1,
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
      pullRequests: 5,
      pullResetsRequired: 1,
      lastResetAt: Date.now(),
      lastResetCursor: 50,
      lastResetOldestAvailableCursor: 100,
      lastResetLatestCursor: 150,
      noteChangesPruneRuns: 2,
      noteChangesPrunedTotal: 8,
      lastNoteChangesPrunedAt: Date.now() - 10_000,
      lastNoteChangesPrunedCount: 3,
    }),
  }));

  const { registerHealthRoutes } = await import('../src/routes/health.js');
  const app = Fastify();
  await registerHealthRoutes(app);
  return app;
}

describe('health route redis readiness gating', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('keeps service ready with redis degraded when strict redis gating is disabled', async () => {
    const app = await buildHealthApp({
      requireRedisForReady: false,
      databaseOk: true,
      redisOk: false,
      redisStatus: 'end',
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.dependencies.redis.ok).toBe(false);
      expect(payload.dependencies.redis.degraded).toBe(true);
      expect(payload.dependencies.redis.requiredForReady).toBe(false);
      expect(payload.dependencies.realtime.mode).toBe('local-fallback');
      expect(payload.dependencies.realtime.degradedReason).toBe('SUBSCRIBER_CONNECT_FAILED');
      expect(payload.dependencies.streamTicket.replayProtectionMode).toBe('best-effort');
    } finally {
      await app.close();
    }
  });

  it('fails readiness with redis degraded when strict redis gating is enabled', async () => {
    const app = await buildHealthApp({
      requireRedisForReady: true,
      databaseOk: true,
      redisOk: false,
      redisStatus: 'end',
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(503);
      const payload = response.json();
      expect(payload.ok).toBe(false);
      expect(payload.dependencies.redis.requiredForReady).toBe(true);
      expect(payload.dependencies.realtime.redisRequiredForReady).toBe(true);
      expect(payload.dependencies.realtime.degradedReason).toBe('SUBSCRIBER_CONNECT_FAILED');
      expect(payload.metrics.sync.pullResetsRequired).toBe(1);
      expect(payload.metrics.maintenance.lastResult.prunedNoteChanges).toBe(2);
    } finally {
      await app.close();
    }
  });
});
