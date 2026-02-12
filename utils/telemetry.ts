export type ClientMetricName =
  | 'persist_writes'
  | 'persist_failures'
  | 'ai_requests'
  | 'ai_failures'
  | 'stale_analysis_drops';

interface ClientMetrics {
  counters: Record<ClientMetricName, number>;
  aiErrorCodes: Record<string, number>;
  latencies: {
    persistMs: number[];
    aiMs: number[];
  };
}

const metrics: ClientMetrics = {
  counters: {
    persist_writes: 0,
    persist_failures: 0,
    ai_requests: 0,
    ai_failures: 0,
    stale_analysis_drops: 0,
  },
  aiErrorCodes: {},
  latencies: {
    persistMs: [],
    aiMs: [],
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
    },
    latencySamples: {
      persistMs: metrics.latencies.persistMs.length,
      aiMs: metrics.latencies.aiMs.length,
    },
  };
}
