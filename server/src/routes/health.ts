import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { checkDatabaseReady, checkRedisReady, getRedisReadyTelemetry } from '../db/client.js';
import { getRealtimeHubStatus } from '../realtime/hub.js';
import { getMaintenanceHealth } from '../services/maintenance.js';
import { getSyncHealthMetrics } from '../services/sync.js';
import { getStreamTicketReplayTelemetry } from '../auth/streamTicketTelemetry.js';

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
    const redisTelemetry = getRedisReadyTelemetry();
    const streamTicket = getStreamTicketReplayTelemetry();
    const sync = getSyncHealthMetrics();
    const realtimeSubscriberReady =
      typeof realtime.subscriberReady === 'boolean' ? realtime.subscriberReady : realtime.distributedFanoutAvailable;
    const realtimePublisherReady =
      typeof realtime.publisherReady === 'boolean' ? realtime.publisherReady : realtime.distributedFanoutAvailable;
    const realtimeDegradedTransitions = Number.isFinite(realtime.degradedTransitions)
      ? realtime.degradedTransitions
      : realtime.currentDegradedForMs > 0
      ? 1
      : 0;
    const lines = [
      '# HELP pocketbrain_sync_cursor_resets_total Total sync pull cursor reset-required responses.',
      '# TYPE pocketbrain_sync_cursor_resets_total counter',
      formatMetricLine('pocketbrain_sync_cursor_resets_total', sync.pullResetsRequired),
      '# HELP pocketbrain_sync_push_ops_total Total sync push operations processed.',
      '# TYPE pocketbrain_sync_push_ops_total counter',
      formatMetricLine('pocketbrain_sync_push_ops_total', sync.pushOpsTotal),
      '# HELP pocketbrain_sync_push_idempotent_replays_total Total idempotent sync push operation replays.',
      '# TYPE pocketbrain_sync_push_idempotent_replays_total counter',
      formatMetricLine('pocketbrain_sync_push_idempotent_replays_total', sync.pushOpsIdempotentReplays),
      '# HELP pocketbrain_sync_push_write_failures_total Total sync push write failures.',
      '# TYPE pocketbrain_sync_push_write_failures_total counter',
      formatMetricLine('pocketbrain_sync_push_write_failures_total', sync.pushOpsWriteFailures),
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
      '# HELP pocketbrain_realtime_subscriber_ready Whether realtime subscriber connectivity is healthy (1=true).',
      '# TYPE pocketbrain_realtime_subscriber_ready gauge',
      formatMetricLine('pocketbrain_realtime_subscriber_ready', realtimeSubscriberReady ? 1 : 0),
      '# HELP pocketbrain_realtime_publisher_ready Whether realtime publisher connectivity is healthy (1=true).',
      '# TYPE pocketbrain_realtime_publisher_ready gauge',
      formatMetricLine('pocketbrain_realtime_publisher_ready', realtimePublisherReady ? 1 : 0),
      '# HELP pocketbrain_realtime_degraded_transitions_total Number of realtime degradations since process start.',
      '# TYPE pocketbrain_realtime_degraded_transitions_total counter',
      formatMetricLine('pocketbrain_realtime_degraded_transitions_total', realtimeDegradedTransitions),
      '# HELP pocketbrain_stream_ticket_replay_store_available Whether stream-ticket replay store is currently reachable (1=true).',
      '# TYPE pocketbrain_stream_ticket_replay_store_available gauge',
      formatMetricLine('pocketbrain_stream_ticket_replay_store_available', streamTicket.replayStoreAvailable ? 1 : 0),
      '# HELP pocketbrain_stream_ticket_replay_degraded Whether stream-ticket replay protection is currently degraded (1=true).',
      '# TYPE pocketbrain_stream_ticket_replay_degraded gauge',
      formatMetricLine('pocketbrain_stream_ticket_replay_degraded', streamTicket.degraded ? 1 : 0),
      '# HELP pocketbrain_stream_ticket_replay_degraded_dwell_seconds Current stream-ticket replay degradation dwell time.',
      '# TYPE pocketbrain_stream_ticket_replay_degraded_dwell_seconds gauge',
      formatMetricLine(
        'pocketbrain_stream_ticket_replay_degraded_dwell_seconds',
        Number((streamTicket.degradedForMs / 1000).toFixed(3))
      ),
      '# HELP pocketbrain_stream_ticket_replay_degraded_dwell_seconds_total Cumulative stream-ticket replay degradation dwell time.',
      '# TYPE pocketbrain_stream_ticket_replay_degraded_dwell_seconds_total counter',
      formatMetricLine(
        'pocketbrain_stream_ticket_replay_degraded_dwell_seconds_total',
        Number((streamTicket.totalDegradedMs / 1000).toFixed(3))
      ),
      '# HELP pocketbrain_stream_ticket_replay_fail_open_total Number of replay-store fail-open bypasses in best-effort mode.',
      '# TYPE pocketbrain_stream_ticket_replay_fail_open_total counter',
      formatMetricLine('pocketbrain_stream_ticket_replay_fail_open_total', streamTicket.failOpenBypasses),
      '# HELP pocketbrain_stream_ticket_replay_storage_unavailable_total Number of replay-store strict-mode failures that returned 503.',
      '# TYPE pocketbrain_stream_ticket_replay_storage_unavailable_total counter',
      formatMetricLine(
        'pocketbrain_stream_ticket_replay_storage_unavailable_total',
        streamTicket.storageUnavailableErrors
      ),
      '# HELP pocketbrain_stream_ticket_replay_rejects_total Number of replayed stream tickets rejected.',
      '# TYPE pocketbrain_stream_ticket_replay_rejects_total counter',
      formatMetricLine('pocketbrain_stream_ticket_replay_rejects_total', streamTicket.replayRejects),
      '# HELP pocketbrain_stream_ticket_replay_mode_strict Whether stream-ticket replay protection is in strict mode (1=strict).',
      '# TYPE pocketbrain_stream_ticket_replay_mode_strict gauge',
      formatMetricLine('pocketbrain_stream_ticket_replay_mode_strict', streamTicket.mode === 'strict' ? 1 : 0),
      '# HELP pocketbrain_redis_ready_degraded Whether redis readiness checks are currently degraded (1=true).',
      '# TYPE pocketbrain_redis_ready_degraded gauge',
      formatMetricLine('pocketbrain_redis_ready_degraded', redisTelemetry.degraded ? 1 : 0),
      '# HELP pocketbrain_redis_ready_degraded_dwell_seconds Current redis readiness degraded dwell time.',
      '# TYPE pocketbrain_redis_ready_degraded_dwell_seconds gauge',
      formatMetricLine(
        'pocketbrain_redis_ready_degraded_dwell_seconds',
        Number((redisTelemetry.degradedForMs / 1000).toFixed(3))
      ),
      '# HELP pocketbrain_redis_ready_degraded_dwell_seconds_total Cumulative redis readiness degraded dwell time.',
      '# TYPE pocketbrain_redis_ready_degraded_dwell_seconds_total counter',
      formatMetricLine(
        'pocketbrain_redis_ready_degraded_dwell_seconds_total',
        Number((redisTelemetry.totalDegradedMs / 1000).toFixed(3))
      ),
      '# HELP pocketbrain_redis_ready_failures_total Number of failed redis readiness checks.',
      '# TYPE pocketbrain_redis_ready_failures_total counter',
      formatMetricLine('pocketbrain_redis_ready_failures_total', redisTelemetry.failuresTotal),
      '# HELP pocketbrain_redis_ready_timeout_total Number of redis readiness checks that timed out.',
      '# TYPE pocketbrain_redis_ready_timeout_total counter',
      formatMetricLine('pocketbrain_redis_ready_timeout_total', redisTelemetry.timeoutsTotal),
      '# HELP pocketbrain_redis_ready_consecutive_failures Consecutive failed redis readiness checks.',
      '# TYPE pocketbrain_redis_ready_consecutive_failures gauge',
      formatMetricLine('pocketbrain_redis_ready_consecutive_failures', redisTelemetry.consecutiveFailures),
      '# HELP pocketbrain_ready_degraded_transitions_total Number of redis readiness degraded-state transitions.',
      '# TYPE pocketbrain_ready_degraded_transitions_total counter',
      formatMetricLine('pocketbrain_ready_degraded_transitions_total', redisTelemetry.degradedTransitions),
      '',
    ];

    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return lines.join('\n');
  });

  app.get('/ready', async (_request, reply) => {
    const [databaseOk, redisState] = await Promise.all([checkDatabaseReady(), checkRedisReady()]);
    const redisRequiredForReady = env.REQUIRE_REDIS_FOR_READY;
    const redisRequiredFailureThreshold = env.REDIS_READY_REQUIRED_CONSECUTIVE_FAILURES ?? 1;
    const redisRequiredDegradedGraceMs = env.REDIS_READY_REQUIRED_DEGRADED_GRACE_MS ?? 0;
    const redisDependencyOk =
      redisState.ok ||
      (redisState.consecutiveFailures < redisRequiredFailureThreshold &&
        redisState.degradedForMs < redisRequiredDegradedGraceMs);
    const readyOk = databaseOk && (!redisRequiredForReady || redisDependencyOk);
    const readyMode = !redisState.ok ? 'degraded' : 'strict';
    const readyCause = !databaseOk ? 'database' : redisRequiredForReady && !redisDependencyOk ? 'redis' : null;
    const now = Date.now();
    const realtime = getRealtimeHubStatus();
    const streamTicket = getStreamTicketReplayTelemetry();
    const maintenance = getMaintenanceHealth();
    const sync = getSyncHealthMetrics();
    const realtimeInitializationState = realtime.initializationState || 'initialized';
    const realtimeDegradedTransitions = Number.isFinite(realtime.degradedTransitions)
      ? realtime.degradedTransitions
      : realtime.currentDegradedForMs > 0
      ? 1
      : 0;
    const realtimeDegradedReason =
      realtime.degradedReason ||
      (!realtime.distributedFanoutAvailable && realtimeInitializationState === 'not-initialized'
        ? 'NOT_INITIALIZED'
        : null);
    const payload = {
      ok: readyOk,
      readyMode,
      readyCause,
      service: 'pocketbrain-server',
      ts: now,
      dependencies: {
        database: {
          ok: databaseOk,
        },
        redis: {
          ...redisState,
          degraded: !redisState.ok,
          requiredForReady: redisRequiredForReady,
          dependencyOk: redisDependencyOk,
          requiredFailureThreshold: redisRequiredFailureThreshold,
          requiredDegradedGraceMs: redisRequiredDegradedGraceMs,
        },
        realtime: {
          initializationState: realtimeInitializationState,
          mode: realtime.distributedFanoutAvailable ? 'distributed' : 'local-fallback',
          degraded: !realtime.distributedFanoutAvailable,
          degradedReason: realtimeDegradedReason,
          degradedSinceTs: realtime.degradedSinceTs,
          degradedForMs: realtime.currentDegradedForMs,
          degradedTransitions: realtimeDegradedTransitions,
          subscriberReady:
            typeof realtime.subscriberReady === 'boolean' ? realtime.subscriberReady : realtime.distributedFanoutAvailable,
          publisherReady:
            typeof realtime.publisherReady === 'boolean' ? realtime.publisherReady : realtime.distributedFanoutAvailable,
          redisRequiredForReady,
        },
        streamTicket: {
          replayProtectionMode: streamTicket.mode,
          replayStoreAvailable: streamTicket.replayStoreAvailable,
          degraded: streamTicket.degraded,
          degradedReason: streamTicket.degradedReason,
          degradedSinceTs: streamTicket.degradedSinceTs,
          degradedForMs: streamTicket.degradedForMs,
          degradedTransitions: streamTicket.degradedTransitions,
          lastErrorAt: streamTicket.lastErrorAt,
          lastErrorMessage: streamTicket.lastErrorMessage,
          consumeAttempts: streamTicket.consumeAttempts,
          consumeSuccesses: streamTicket.consumeSuccesses,
          replayRejects: streamTicket.replayRejects,
          failOpenBypasses: streamTicket.failOpenBypasses,
          storageUnavailableErrors: streamTicket.storageUnavailableErrors,
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
