import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
