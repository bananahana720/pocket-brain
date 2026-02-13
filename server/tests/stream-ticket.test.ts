import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_ENV = { ...process.env };
const redisSetMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  redis: {
    set: redisSetMock,
  },
}));

describe('stream ticket auth', () => {
  beforeEach(() => {
    redisSetMock.mockReset();
    redisSetMock.mockResolvedValue('OK');
  });

  afterEach(() => {
    process.env = { ...BASE_ENV };
    vi.resetModules();
    vi.useRealTimers();
  });

  it('issues and consumes valid ticket claims', async () => {
    const { issueStreamTicket, consumeStreamTicket } = await import('../src/auth/streamTicket.js');

    const issued = issueStreamTicket({
      subject: 'user_1',
      deviceId: '11111111-1111-4111-8111-111111111111',
      ttlSeconds: 60,
    });

    const claims = await consumeStreamTicket(issued.token);
    expect(claims.sub).toBe('user_1');
    expect(claims.deviceId).toBe('11111111-1111-4111-8111-111111111111');
    expect(redisSetMock).toHaveBeenCalledTimes(1);
  });

  it('rejects expired tickets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const { issueStreamTicket, consumeStreamTicket } = await import('../src/auth/streamTicket.js');
    const issued = issueStreamTicket({
      subject: 'user_expired',
      deviceId: '22222222-2222-4222-8222-222222222222',
      ttlSeconds: 60,
    });

    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));
    await expect(consumeStreamTicket(issued.token)).rejects.toMatchObject({
      code: 'STREAM_TICKET_EXPIRED',
    });
  });

  it('rejects replayed tickets when replay key already exists', async () => {
    const { issueStreamTicket, consumeStreamTicket } = await import('../src/auth/streamTicket.js');
    const issued = issueStreamTicket({
      subject: 'user_replay',
      deviceId: '33333333-3333-4333-8333-333333333333',
      ttlSeconds: 60,
    });

    redisSetMock.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(consumeStreamTicket(issued.token)).resolves.toMatchObject({
      sub: 'user_replay',
    });

    await expect(consumeStreamTicket(issued.token)).rejects.toMatchObject({
      code: 'STREAM_TICKET_REPLAYED',
    });
  });

  it('tracks replay-store fail-open degradation telemetry in best-effort mode', async () => {
    const { issueStreamTicket, consumeStreamTicket } = await import('../src/auth/streamTicket.js');
    const { getStreamTicketReplayTelemetry, resetStreamTicketReplayTelemetryForTests } = await import(
      '../src/auth/streamTicketTelemetry.js'
    );
    resetStreamTicketReplayTelemetryForTests();

    redisSetMock.mockRejectedValueOnce(new Error('redis timeout'));

    const firstTicket = issueStreamTicket({
      subject: 'user_degraded',
      deviceId: '44444444-4444-4444-8444-444444444444',
      ttlSeconds: 60,
    });
    await expect(consumeStreamTicket(firstTicket.token)).resolves.toMatchObject({
      sub: 'user_degraded',
    });

    const degradedTelemetry = getStreamTicketReplayTelemetry();
    expect(degradedTelemetry.mode).toBe('best-effort');
    expect(degradedTelemetry.degraded).toBe(true);
    expect(degradedTelemetry.replayStoreAvailable).toBe(false);
    expect(degradedTelemetry.degradedReason).toBe('REDIS_SET_FAILED');
    expect(degradedTelemetry.failOpenBypasses).toBe(1);
    expect(degradedTelemetry.storageUnavailableErrors).toBe(0);

    const secondTicket = issueStreamTicket({
      subject: 'user_recovered',
      deviceId: '55555555-5555-4555-8555-555555555555',
      ttlSeconds: 60,
    });
    await expect(consumeStreamTicket(secondTicket.token)).resolves.toMatchObject({
      sub: 'user_recovered',
    });

    const recoveredTelemetry = getStreamTicketReplayTelemetry();
    expect(recoveredTelemetry.degraded).toBe(false);
    expect(recoveredTelemetry.replayStoreAvailable).toBe(true);
    expect(recoveredTelemetry.consumeAttempts).toBe(2);
    expect(recoveredTelemetry.consumeSuccesses).toBe(2);
  });
});
