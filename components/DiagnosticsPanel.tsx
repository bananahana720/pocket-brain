import React, { useEffect, useState } from 'react';
import { getClientMetricsSnapshot } from '../utils/telemetry';

interface WorkerMetrics {
  requests: number;
  authFailures: number;
  providerFailures: number;
  retries: number;
  timeouts: number;
  rateLimited: number;
  circuitOpens: number;
  vpsProxyFailures: number;
  vpsProxyTimeouts: number;
  vpsProxyRetries: number;
  vpsProxyCircuitOpens: number;
  vpsProxyCircuitRejects: number;
  vpsProxyNoRetryPathHits: number;
  vpsProxyRetryAfterHonored: number;
  vpsProxy5xxPassthrough: number;
}

interface WorkerDiagnostics {
  metrics: WorkerMetrics;
  failureCauses?: {
    upstream?: Record<string, number>;
    provider?: Record<string, number>;
  };
  reliability?: {
    authConfig?: Record<string, number>;
    runtimeConfig?: Record<string, number>;
    secretRotation?: Record<string, number>;
    kvFailures?: number;
  };
}

const DiagnosticsPanel: React.FC = () => {
  const [clientMetrics, setClientMetrics] = useState(() => getClientMetricsSnapshot());
  const [workerDiagnostics, setWorkerDiagnostics] = useState<WorkerDiagnostics | null>(null);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      setClientMetrics(getClientMetricsSnapshot());

      try {
        const res = await fetch('/api/v1/metrics', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.metrics) {
          setWorkerDiagnostics(json as WorkerDiagnostics);
        }
      } catch {
        // Optional endpoint in local dev.
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <aside
      data-testid="diagnostics-panel"
      className="mission-note fixed bottom-4 left-4 z-[75] w-72 rounded-xl border border-zinc-300/70 p-3 text-[11px] shadow-xl backdrop-blur dark:border-zinc-700/70 dark:text-zinc-200 pointer-events-none"
    >
      <p className="mb-2 font-display text-lg leading-none text-zinc-500 dark:text-zinc-400">Diagnostics</p>
      <div className="space-y-1 text-zinc-700 dark:text-zinc-300">
        <p>AI requests: {clientMetrics.counters.ai_requests}</p>
        <p>AI failures: {clientMetrics.counters.ai_failures}</p>
        <p>AI payload avg: {clientMetrics.latencyAverages.aiPayloadBytes} bytes</p>
        <p>Capture write-through success: {clientMetrics.counters.capture_write_through_success}</p>
        <p>Capture write-through failure: {clientMetrics.counters.capture_write_through_failure}</p>
        <p>Capture retries clicked: {clientMetrics.counters.capture_retry_clicked}</p>
        <p>Sync conflict-loop blocks: {clientMetrics.counters.sync_conflict_loop_blocks}</p>
        <p>Sync cursor resets: {clientMetrics.counters.sync_cursor_resets}</p>
        <p>Sync cursor reset recoveries: {clientMetrics.counters.sync_cursor_reset_recoveries}</p>
        <p>Sync queue compaction drops: {clientMetrics.counters.sync_queue_compaction_drops}</p>
        <p>Sync queue overflow events: {clientMetrics.counters.sync_queue_overflow_events}</p>
        <p>Sync queue overflow recoveries: {clientMetrics.counters.sync_queue_overflow_recovery_events}</p>
        <p>Sync overflow writes: {clientMetrics.counters.sync_queue_overflow_writes}</p>
        <p>Sync overflow drains: {clientMetrics.counters.sync_queue_overflow_drains}</p>
        <p>Sync overflow rehydrated: {clientMetrics.counters.sync_queue_overflow_rehydrated}</p>
        <p>Sync overflow hard-block events: {clientMetrics.counters.sync_queue_overflow_block_events}</p>
        <p>Sync queue block events: {clientMetrics.counters.sync_queue_block_events}</p>
        <p>Sync queue recoveries: {clientMetrics.counters.sync_queue_recovery_events}</p>
        <p>Sync queue persistence blocks: {clientMetrics.counters.sync_queue_persistence_blocks}</p>
        <p>Sync blocked mutations: {clientMetrics.counters.sync_queue_blocked_mutations}</p>
        <p>Sync Retry-After honored: {clientMetrics.counters.sync_retry_after_honored}</p>
        <p>Sync Retry-After applied: {clientMetrics.counters.sync_retry_after_applied}</p>
        <p>Sync forced polling: {clientMetrics.counters.sync_retry_forced_polling}</p>
        <p>Sync polling forced: {clientMetrics.counters.sync_polling_forced}</p>
        <p>Sync VPS circuit-open causes: {clientMetrics.counters.sync_vps_circuit_open}</p>
        <p>Avg capture visible: {clientMetrics.latencyAverages.captureVisibleMs}ms</p>
        <p>Avg capture write-through: {clientMetrics.latencyAverages.captureWriteMs}ms</p>
        <p>Stale drops: {clientMetrics.counters.stale_analysis_drops}</p>
        <p>Persist writes: {clientMetrics.counters.persist_writes}</p>
        <p>Persist failures: {clientMetrics.counters.persist_failures}</p>
        <p>Capture persistence primary failures: {clientMetrics.counters.capture_persistence_primary_failures}</p>
        <p>Capture persistence fallback failures: {clientMetrics.counters.capture_persistence_fallback_failures}</p>
        <p>Capture persistence recoveries: {clientMetrics.counters.capture_persistence_recoveries}</p>
        <p>Load failures: {clientMetrics.counters.load_failures}</p>
        <p>Storage persist granted: {clientMetrics.counters.storage_persist_granted}</p>
        <p>Storage persist denied: {clientMetrics.counters.storage_persist_denied}</p>
        <p>Queue dropped: {clientMetrics.counters.analysis_queue_dropped}</p>
        <p>Queue pauses: {clientMetrics.counters.analysis_queue_pauses}</p>
        <p>Queue stale pruned: {clientMetrics.counters.analysis_queue_stale_pruned}</p>
        <p>Dead-lettered: {clientMetrics.counters.analysis_dead_lettered}</p>
        <p>Queue recovered: {clientMetrics.counters.analysis_queue_recovered}</p>
        <p>Backups: {clientMetrics.counters.backup_writes}</p>
        <p>Backup failures: {clientMetrics.counters.backup_failures}</p>
        <p>Periodic flushes: {clientMetrics.counters.persist_periodic_flushes}</p>
        <p>Persist retry success: {clientMetrics.counters.persist_retry_success}</p>
        <p>Persist retry failures: {clientMetrics.counters.persist_retry_failures}</p>
        <p>Avg persist: {clientMetrics.latencyAverages.persistMs}ms</p>
        <p>Avg AI: {clientMetrics.latencyAverages.aiMs}ms</p>
      </div>
      {workerDiagnostics && (
        <div className="mt-2 border-t border-zinc-200 pt-2 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          <p>Worker requests: {workerDiagnostics.metrics.requests}</p>
          <p>Worker auth failures: {workerDiagnostics.metrics.authFailures}</p>
          <p>Worker provider failures: {workerDiagnostics.metrics.providerFailures}</p>
          <p>Worker retries: {workerDiagnostics.metrics.retries}</p>
          <p>Worker timeouts: {workerDiagnostics.metrics.timeouts}</p>
          <p>Worker rate-limited: {workerDiagnostics.metrics.rateLimited}</p>
          <p>Worker circuit opens: {workerDiagnostics.metrics.circuitOpens}</p>
          <p>Worker VPS proxy failures: {workerDiagnostics.metrics.vpsProxyFailures}</p>
          <p>Worker VPS proxy timeouts: {workerDiagnostics.metrics.vpsProxyTimeouts}</p>
          <p>Worker VPS proxy retries: {workerDiagnostics.metrics.vpsProxyRetries}</p>
          <p>Worker VPS circuit opens: {workerDiagnostics.metrics.vpsProxyCircuitOpens}</p>
          <p>Worker VPS circuit rejects: {workerDiagnostics.metrics.vpsProxyCircuitRejects}</p>
          <p>Worker VPS no-retry path hits: {workerDiagnostics.metrics.vpsProxyNoRetryPathHits}</p>
          <p>Worker Retry-After honored: {workerDiagnostics.metrics.vpsProxyRetryAfterHonored}</p>
          <p>Worker upstream 5xx passthrough: {workerDiagnostics.metrics.vpsProxy5xxPassthrough}</p>
          <p>
            Worker upstream causes:{' '}
            {JSON.stringify(workerDiagnostics.failureCauses?.upstream || {})}
          </p>
          <p>
            Worker provider causes:{' '}
            {JSON.stringify(workerDiagnostics.failureCauses?.provider || {})}
          </p>
          <p>
            Worker reliability:{' '}
            {JSON.stringify(workerDiagnostics.reliability || {})}
          </p>
        </div>
      )}
    </aside>
  );
};

export default React.memo(DiagnosticsPanel);
