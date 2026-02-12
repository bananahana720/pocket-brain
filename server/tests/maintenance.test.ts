import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pruneTombstonesMock = vi.hoisted(() => vi.fn());
const whereMock = vi.hoisted(() => vi.fn());
const returningMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/sync.js', () => ({
  pruneTombstones: pruneTombstonesMock,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    delete: deleteMock,
  },
}));

describe('maintenance service', () => {
  beforeEach(() => {
    pruneTombstonesMock.mockReset();
    whereMock.mockReset();
    returningMock.mockReset();
    deleteMock.mockReset();

    pruneTombstonesMock.mockResolvedValue(2);
    returningMock.mockResolvedValue([{ requestId: 'a' }, { requestId: 'b' }]);
    whereMock.mockReturnValue({ returning: returningMock });
    deleteMock.mockReturnValue({ where: whereMock });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs maintenance cycle and reports counts', async () => {
    const { runMaintenanceCycle } = await import('../src/services/maintenance.js');
    const result = await runMaintenanceCycle();

    expect(pruneTombstonesMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      prunedTombstones: 2,
      removedIdempotencyKeys: 2,
    });
  });

  it('runs maintenance loop immediately and on interval', async () => {
    vi.useFakeTimers();
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    const { startMaintenanceLoop } = await import('../src/services/maintenance.js');
    const stop = startMaintenanceLoop(logger);

    await vi.runOnlyPendingTimersAsync();
    const initialCalls = pruneTombstonesMock.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(pruneTombstonesMock.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(logger.error).not.toHaveBeenCalled();

    stop();
  });
});
