import { env } from '../config/env.js';

export type StreamTicketReplayDegradedReason = 'REDIS_SET_FAILED';
export type StreamTicketReplayMode = 'strict' | 'best-effort';

export interface StreamTicketReplayTelemetry {
  mode: StreamTicketReplayMode;
  replayStoreAvailable: boolean;
  degraded: boolean;
  degradedReason: StreamTicketReplayDegradedReason | null;
  degradedSinceTs: number | null;
  degradedForMs: number;
  totalDegradedMs: number;
  degradedTransitions: number;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  consumeAttempts: number;
  consumeSuccesses: number;
  replayRejects: number;
  failOpenBypasses: number;
  storageUnavailableErrors: number;
}

interface StreamTicketReplayTelemetryState {
  replayStoreAvailable: boolean;
  degradedSinceTs: number | null;
  totalDegradedMs: number;
  degradedTransitions: number;
  degradedReason: StreamTicketReplayDegradedReason | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  consumeAttempts: number;
  consumeSuccesses: number;
  replayRejects: number;
  failOpenBypasses: number;
  storageUnavailableErrors: number;
}

const INITIAL_REPLAY_STORE_STATE: StreamTicketReplayTelemetryState = {
  replayStoreAvailable: true,
  degradedSinceTs: null,
  totalDegradedMs: 0,
  degradedTransitions: 0,
  degradedReason: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  consumeAttempts: 0,
  consumeSuccesses: 0,
  replayRejects: 0,
  failOpenBypasses: 0,
  storageUnavailableErrors: 0,
};

let replayStoreState: StreamTicketReplayTelemetryState = {
  ...INITIAL_REPLAY_STORE_STATE,
};

function getReplayMode(): StreamTicketReplayMode {
  return env.NODE_ENV === 'production' ? 'strict' : 'best-effort';
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'unknown stream ticket replay-store error';
}

export function recordStreamTicketConsumeAttempt(): void {
  replayStoreState.consumeAttempts += 1;
}

export function recordStreamTicketConsumeSuccess(): void {
  replayStoreState.consumeSuccesses += 1;
}

export function recordStreamTicketReplayReject(): void {
  replayStoreState.replayRejects += 1;
}

export function recordStreamTicketStorageUnavailable(): void {
  replayStoreState.storageUnavailableErrors += 1;
}

export function recordStreamTicketFailOpenBypass(): void {
  replayStoreState.failOpenBypasses += 1;
}

export function markStreamTicketReplayStoreHealthy(now = Date.now()): void {
  replayStoreState.replayStoreAvailable = true;
  replayStoreState.degradedReason = null;
  if (replayStoreState.degradedSinceTs !== null) {
    replayStoreState.totalDegradedMs += Math.max(0, now - replayStoreState.degradedSinceTs);
    replayStoreState.degradedSinceTs = null;
  }
}

export function markStreamTicketReplayStoreDegraded(
  error: unknown,
  reason: StreamTicketReplayDegradedReason = 'REDIS_SET_FAILED',
  now = Date.now()
): void {
  replayStoreState.replayStoreAvailable = false;
  replayStoreState.degradedReason = reason;
  replayStoreState.lastErrorAt = now;
  replayStoreState.lastErrorMessage = formatErrorMessage(error);
  if (replayStoreState.degradedSinceTs === null) {
    replayStoreState.degradedSinceTs = now;
    replayStoreState.degradedTransitions += 1;
  }
}

export function getStreamTicketReplayTelemetry(): StreamTicketReplayTelemetry {
  const now = Date.now();
  const degradedForMs =
    replayStoreState.degradedSinceTs === null ? 0 : Math.max(0, now - replayStoreState.degradedSinceTs);
  return {
    mode: getReplayMode(),
    replayStoreAvailable: replayStoreState.replayStoreAvailable,
    degraded: replayStoreState.degradedSinceTs !== null,
    degradedReason: replayStoreState.degradedReason,
    degradedSinceTs: replayStoreState.degradedSinceTs,
    degradedForMs,
    totalDegradedMs: replayStoreState.totalDegradedMs + degradedForMs,
    degradedTransitions: replayStoreState.degradedTransitions,
    lastErrorAt: replayStoreState.lastErrorAt,
    lastErrorMessage: replayStoreState.lastErrorMessage,
    consumeAttempts: replayStoreState.consumeAttempts,
    consumeSuccesses: replayStoreState.consumeSuccesses,
    replayRejects: replayStoreState.replayRejects,
    failOpenBypasses: replayStoreState.failOpenBypasses,
    storageUnavailableErrors: replayStoreState.storageUnavailableErrors,
  };
}

export function resetStreamTicketReplayTelemetryForTests(): void {
  if (env.NODE_ENV !== 'test') return;
  replayStoreState = {
    ...INITIAL_REPLAY_STORE_STATE,
  };
}
