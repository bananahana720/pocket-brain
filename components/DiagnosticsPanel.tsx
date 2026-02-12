import React, { useEffect, useState } from 'react';
import { getClientMetricsSnapshot } from '../utils/telemetry';

interface WorkerMetrics {
  authFailures: number;
  providerFailures: number;
  retries: number;
  timeouts: number;
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
    <aside className="fixed bottom-4 left-4 z-[75] w-72 rounded-xl border border-zinc-300 bg-white/95 p-3 text-[11px] shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200">
      <p className="mb-2 font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Diagnostics</p>
      <div className="space-y-1 text-zinc-700 dark:text-zinc-300">
        <p>AI requests: {clientMetrics.counters.ai_requests}</p>
        <p>AI failures: {clientMetrics.counters.ai_failures}</p>
        <p>Stale drops: {clientMetrics.counters.stale_analysis_drops}</p>
        <p>Persist writes: {clientMetrics.counters.persist_writes}</p>
        <p>Persist failures: {clientMetrics.counters.persist_failures}</p>
        <p>Avg persist: {clientMetrics.latencyAverages.persistMs}ms</p>
        <p>Avg AI: {clientMetrics.latencyAverages.aiMs}ms</p>
      </div>
      {workerMetrics && (
        <div className="mt-2 border-t border-zinc-200 pt-2 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          <p>Worker auth failures: {workerMetrics.authFailures}</p>
          <p>Worker provider failures: {workerMetrics.providerFailures}</p>
          <p>Worker retries: {workerMetrics.retries}</p>
          <p>Worker timeouts: {workerMetrics.timeouts}</p>
        </div>
      )}
    </aside>
  );
};

export default React.memo(DiagnosticsPanel);
