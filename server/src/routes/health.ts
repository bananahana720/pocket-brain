import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { checkDatabaseReady, checkRedisReady } from '../db/client.js';
import { getRealtimeHubStatus } from '../realtime/hub.js';
import { getMaintenanceHealth } from '../services/maintenance.js';
import { getSyncHealthMetrics } from '../services/sync.js';

function formatMetricLine(name: string, value: number): string {
  if (!Number.isFinite(value)) {
    return `${name} 0`;
  }
  return `${name} ${value}`;
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'pocketbrain-server', ts: Date.now() }));

  app.get('/metrics', async (_request, reply) => {
    const realtime = getRealtimeHubStatus();
    const sync = getSyncHealthMetrics();
    const lines = [
      '# HELP pocketbrain_sync_cursor_resets_total Total sync pull cursor reset-required responses.',
      '# TYPE pocketbrain_sync_cursor_resets_total counter',
      formatMetricLine('pocketbrain_sync_cursor_resets_total', sync.pullResetsRequired),
      '# HELP pocketbrain_note_changes_pruned_total Total note change rows pruned by retention maintenance.',
      '# TYPE pocketbrain_note_changes_pruned_total counter',
      formatMetricLine('pocketbrain_note_changes_pruned_total', sync.noteChangesPrunedTotal),
      '# HELP pocketbrain_realtime_fallback_active Whether realtime fanout is currently in local-fallback mode (1=true).',
      '# TYPE pocketbrain_realtime_fallback_active gauge',
      formatMetricLine('pocketbrain_realtime_fallback_active', realtime.distributedFanoutAvailable ? 0 : 1),
      '# HELP pocketbrain_realtime_fallback_dwell_seconds Current dwell time in fallback mode.',
      '# TYPE pocketbrain_realtime_fallback_dwell_seconds gauge',
      formatMetricLine('pocketbrain_realtime_fallback_dwell_seconds', Number((realtime.currentDegradedForMs / 1000).toFixed(3))),
      '# HELP pocketbrain_realtime_fallback_dwell_seconds_total Cumulative fallback dwell time since process start.',
      '# TYPE pocketbrain_realtime_fallback_dwell_seconds_total counter',
      formatMetricLine(
        'pocketbrain_realtime_fallback_dwell_seconds_total',
        Number((realtime.totalDegradedMs / 1000).toFixed(3))
      ),
      '',
    ];

    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return lines.join('\n');
  });

  app.get('/ready', async (_request, reply) => {
    const [databaseOk, redisState] = await Promise.all([checkDatabaseReady(), checkRedisReady()]);
    const redisRequiredForReady = env.REQUIRE_REDIS_FOR_READY;
    const readyOk = databaseOk && (!redisRequiredForReady || redisState.ok);
    const now = Date.now();
    const realtime = getRealtimeHubStatus();
    const maintenance = getMaintenanceHealth();
    const sync = getSyncHealthMetrics();
    const payload = {
      ok: readyOk,
      service: 'pocketbrain-server',
      ts: now,
      dependencies: {
        database: {
          ok: databaseOk,
        },
        redis: {
          ...redisState,
          requiredForReady: redisRequiredForReady,
        },
        realtime: {
          mode: realtime.distributedFanoutAvailable ? 'distributed' : 'local-fallback',
          degraded: !realtime.distributedFanoutAvailable,
          degradedSinceTs: realtime.degradedSinceTs,
          degradedForMs: realtime.currentDegradedForMs,
          redisRequiredForReady,
        },
      },
      metrics: {
        sync,
        maintenance,
      },
    };

    if (!readyOk) {
      reply.code(503).send(payload);
      return;
    }

    return payload;
  });
}
