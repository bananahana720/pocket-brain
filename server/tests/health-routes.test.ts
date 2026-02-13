import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerHealthRoutes } from '../src/routes/health.js';
import * as dbClient from '../src/db/client.js';

describe('health routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await registerHealthRoutes(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns ready when database is healthy', async () => {
    vi.spyOn(dbClient, 'checkDatabaseReady').mockResolvedValue(true);
    vi.spyOn(dbClient, 'checkRedisReady').mockResolvedValue({
      ok: true,
      status: 'ready',
      checksTotal: 1,
      failuresTotal: 0,
      consecutiveFailures: 0,
      lastCheckAt: Date.now(),
      lastCheckDurationMs: 2,
      lastSuccessAt: Date.now(),
      lastFailureAt: null,
      lastErrorMessage: null,
      degraded: false,
      degradedSinceTs: null,
      degradedForMs: 0,
      totalDegradedMs: 0,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.ok).toBe(true);
    expect(payload.dependencies.database.ok).toBe(true);
    expect(payload.dependencies.redis.ok).toBe(true);
    expect(payload.dependencies.redis.degraded).toBe(false);
    expect(payload.dependencies.realtime.mode).toBeDefined();
    expect(payload.dependencies.realtime.degradedReason).toBe('NOT_INITIALIZED');
    expect(payload.dependencies.streamTicket.replayProtectionMode).toBe('best-effort');
    expect(payload.dependencies.streamTicket.replayStoreAvailable).toBe(true);
    expect(payload.metrics.sync.pullRequests).toBeTypeOf('number');
    expect(payload.metrics.maintenance.cyclesRun).toBeTypeOf('number');
  });

  it('returns 503 when database is unhealthy', async () => {
    vi.spyOn(dbClient, 'checkDatabaseReady').mockResolvedValue(false);
    vi.spyOn(dbClient, 'checkRedisReady').mockResolvedValue({
      ok: false,
      status: 'end',
      checksTotal: 1,
      failuresTotal: 1,
      consecutiveFailures: 1,
      lastCheckAt: Date.now(),
      lastCheckDurationMs: 2,
      lastSuccessAt: null,
      lastFailureAt: Date.now(),
      lastErrorMessage: 'redis down',
      degraded: true,
      degradedSinceTs: Date.now() - 1_000,
      degradedForMs: 1_000,
      totalDegradedMs: 1_000,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    const payload = response.json();
    expect(payload.ok).toBe(false);
    expect(payload.dependencies.database.ok).toBe(false);
    expect(payload.dependencies.redis.degraded).toBe(true);
  });

  it('returns prometheus metrics payload for scrape integrations', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('pocketbrain_sync_cursor_resets_total');
    expect(response.body).toContain('pocketbrain_note_changes_pruned_total');
    expect(response.body).toContain('pocketbrain_realtime_fallback_dwell_seconds');
    expect(response.body).toContain('pocketbrain_realtime_fallback_active');
    expect(response.body).toContain('pocketbrain_realtime_fallback_dwell_seconds_total');
    expect(response.body).toContain('pocketbrain_realtime_subscriber_ready');
    expect(response.body).toContain('pocketbrain_stream_ticket_replay_store_available');
    expect(response.body).toContain('pocketbrain_stream_ticket_replay_degraded');
    expect(response.body).toContain('pocketbrain_redis_ready_failures_total');
  });
});
