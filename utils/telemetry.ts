export type ClientMetricName =
  | 'persist_writes'
  | 'persist_failures'
  | 'load_failures'
  | 'storage_persist_granted'
  | 'storage_persist_denied'
  | 'analysis_queue_dropped'
  | 'analysis_dead_lettered'
  | 'analysis_queue_persist_failures'
  | 'analysis_queue_recovered'
  | 'backup_writes'
  | 'backup_failures'
  | 'persist_periodic_flushes'
  | 'ai_requests'
  | 'ai_payload_samples'
  | 'ai_failures'
  | 'stale_analysis_drops'
  | 'analysis_queue_pauses'
  | 'analysis_queue_stale_pruned'
  | 'capture_write_through_success'
  | 'capture_write_through_failure'
  | 'capture_retry_clicked'
  | 'sync_conflict_loop_blocks'
  | 'sync_cursor_resets'
  | 'sync_cursor_reset_recoveries'
  | 'sync_queue_compaction_drops'
  | 'sync_queue_block_events'
  | 'sync_queue_blocked_mutations';

interface ClientMetrics {
  counters: Record<ClientMetricName, number>;
  aiErrorCodes: Record<string, number>;
  latencies: {
    persistMs: number[];
    aiMs: number[];
    aiPayloadBytes: number[];
    captureWriteMs: number[];
    captureVisibleMs: number[];
  };
}

const metrics: ClientMetrics = {
  counters: {
    persist_writes: 0,
    persist_failures: 0,
    load_failures: 0,
    storage_persist_granted: 0,
    storage_persist_denied: 0,
    analysis_queue_dropped: 0,
    analysis_dead_lettered: 0,
    analysis_queue_persist_failures: 0,
    analysis_queue_recovered: 0,
    backup_writes: 0,
    backup_failures: 0,
    persist_periodic_flushes: 0,
    ai_requests: 0,
    ai_payload_samples: 0,
    ai_failures: 0,
    stale_analysis_drops: 0,
    analysis_queue_pauses: 0,
    analysis_queue_stale_pruned: 0,
    capture_write_through_success: 0,
    capture_write_through_failure: 0,
    capture_retry_clicked: 0,
    sync_conflict_loop_blocks: 0,
    sync_cursor_resets: 0,
    sync_cursor_reset_recoveries: 0,
    sync_queue_compaction_drops: 0,
    sync_queue_block_events: 0,
    sync_queue_blocked_mutations: 0,
  },
  aiErrorCodes: {},
  latencies: {
    persistMs: [],
    aiMs: [],
    aiPayloadBytes: [],
    captureWriteMs: [],
    captureVisibleMs: [],
  },
};

function pushBounded(arr: number[], value: number, limit = 200): void {
  arr.push(value);
  if (arr.length > limit) {
    arr.splice(0, arr.length - limit);
  }
}

export function incrementMetric(name: ClientMetricName, by = 1): void {
  metrics.counters[name] += by;
}

export function recordPersistLatency(ms: number): void {
  pushBounded(metrics.latencies.persistMs, ms);
}

export function recordAiLatency(ms: number): void {
  pushBounded(metrics.latencies.aiMs, ms);
}

export function recordAiPayloadBytes(bytes: number): void {
  pushBounded(metrics.latencies.aiPayloadBytes, bytes);
}

export function recordCaptureWriteThroughLatency(ms: number): void {
  pushBounded(metrics.latencies.captureWriteMs, ms);
}

export function recordCaptureVisibleLatency(ms: number): void {
  pushBounded(metrics.latencies.captureVisibleMs, ms);
}

export function recordAiErrorCode(code: string): void {
  metrics.aiErrorCodes[code] = (metrics.aiErrorCodes[code] || 0) + 1;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, val) => sum + val, 0) / values.length);
}

export function getClientMetricsSnapshot() {
  return {
    counters: { ...metrics.counters },
    aiErrorCodes: { ...metrics.aiErrorCodes },
    latencyAverages: {
      persistMs: average(metrics.latencies.persistMs),
      aiMs: average(metrics.latencies.aiMs),
      aiPayloadBytes: average(metrics.latencies.aiPayloadBytes),
      captureWriteMs: average(metrics.latencies.captureWriteMs),
      captureVisibleMs: average(metrics.latencies.captureVisibleMs),
    },
    latencySamples: {
      persistMs: metrics.latencies.persistMs.length,
      aiMs: metrics.latencies.aiMs.length,
      aiPayloadBytes: metrics.latencies.aiPayloadBytes.length,
      captureWriteMs: metrics.latencies.captureWriteMs.length,
      captureVisibleMs: metrics.latencies.captureVisibleMs.length,
    },
  };
}
