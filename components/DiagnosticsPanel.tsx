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
}

const DiagnosticsPanel: React.FC = () => {
  const [clientMetrics, setClientMetrics] = useState(() => getClientMetricsSnapshot());
  const [workerMetrics, setWorkerMetrics] = useState<WorkerMetrics | null>(null);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      setClientMetrics(getClientMetricsSnapshot());

      try {
        const res = await fetch('/api/v1/metrics', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.metrics) {
          setWorkerMetrics(json.metrics as WorkerMetrics);
        }
      } catch {
        // Optional endpoint in local dev.
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <aside className="mission-note fixed bottom-4 left-4 z-[75] w-72 rounded-xl border border-zinc-300/70 p-3 text-[11px] shadow-xl backdrop-blur dark:border-zinc-700/70 dark:text-zinc-200">
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
        <p>Sync queue compaction drops: {clientMetrics.counters.sync_queue_compaction_drops}</p>
        <p>Sync queue cap drops: {clientMetrics.counters.sync_queue_cap_drops}</p>
        <p>Sync queue cap events: {clientMetrics.counters.sync_queue_cap_events}</p>
        <p>Avg capture visible: {clientMetrics.latencyAverages.captureVisibleMs}ms</p>
        <p>Avg capture write-through: {clientMetrics.latencyAverages.captureWriteMs}ms</p>
        <p>Stale drops: {clientMetrics.counters.stale_analysis_drops}</p>
        <p>Persist writes: {clientMetrics.counters.persist_writes}</p>
        <p>Persist failures: {clientMetrics.counters.persist_failures}</p>
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
        <p>Avg persist: {clientMetrics.latencyAverages.persistMs}ms</p>
        <p>Avg AI: {clientMetrics.latencyAverages.aiMs}ms</p>
      </div>
      {workerMetrics && (
        <div className="mt-2 border-t border-zinc-200 pt-2 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          <p>Worker requests: {workerMetrics.requests}</p>
          <p>Worker auth failures: {workerMetrics.authFailures}</p>
          <p>Worker provider failures: {workerMetrics.providerFailures}</p>
          <p>Worker retries: {workerMetrics.retries}</p>
          <p>Worker timeouts: {workerMetrics.timeouts}</p>
          <p>Worker rate-limited: {workerMetrics.rateLimited}</p>
          <p>Worker circuit opens: {workerMetrics.circuitOpens}</p>
          <p>Worker VPS proxy failures: {workerMetrics.vpsProxyFailures}</p>
          <p>Worker VPS proxy timeouts: {workerMetrics.vpsProxyTimeouts}</p>
          <p>Worker VPS proxy retries: {workerMetrics.vpsProxyRetries}</p>
        </div>
      )}
    </aside>
  );
};

export default React.memo(DiagnosticsPanel);
