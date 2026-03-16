import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./checkpoint', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
}));

vi.mock('./api', () => ({
  fetchEvents: vi.fn(),
}));

vi.mock('./insert', () => ({
  bulkInsert: vi.fn(),
}));

vi.mock('./cursor', () => ({
  isCursorStale: vi.fn(() => false),
  getCursorThreshold: vi.fn(() => 60),
}));

import { loadCheckpoint, saveCheckpoint } from './checkpoint';
import { fetchEvents } from './api';
import { bulkInsert } from './insert';
import { runWorker } from './worker';

const makeEvent = (id: string) => ({
  id,
  event_type: 'test',
  timestamp: '2024-01-15T10:30:00.000Z',
  payload: {},
});

describe('runWorker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts from null cursor on fresh run (no checkpoint)', async () => {
    vi.mocked(loadCheckpoint).mockResolvedValue(null);
    vi.mocked(fetchEvents).mockResolvedValue({ data: [], hasMore: false, nextCursor: null });
    vi.mocked(bulkInsert).mockResolvedValue(0);
    vi.mocked(saveCheckpoint).mockResolvedValue();

    await runWorker();

    expect(fetchEvents).toHaveBeenCalledWith(null, expect.any(Number));
  });

  it('resumes from existing checkpoint cursor', async () => {
    vi.mocked(loadCheckpoint).mockResolvedValue({ cursor: 'saved-cursor', eventsIngested: 500 });
    vi.mocked(fetchEvents).mockResolvedValue({ data: [], hasMore: false, nextCursor: null });
    vi.mocked(bulkInsert).mockResolvedValue(0);
    vi.mocked(saveCheckpoint).mockResolvedValue();

    await runWorker();

    expect(fetchEvents).toHaveBeenCalledWith('saved-cursor', expect.any(Number));
  });

  it('saves checkpoint after each batch', async () => {
    vi.mocked(loadCheckpoint).mockResolvedValue(null);
    vi.mocked(fetchEvents)
      .mockResolvedValueOnce({ data: [makeEvent('e1'), makeEvent('e2')], hasMore: true, nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ data: [], hasMore: false, nextCursor: null });
    vi.mocked(bulkInsert).mockResolvedValue(2);
    vi.mocked(saveCheckpoint).mockResolvedValue();

    await runWorker();

    expect(saveCheckpoint).toHaveBeenCalledWith('cursor-2', 2);
  });

  it('stops when hasMore is false', async () => {
    vi.mocked(loadCheckpoint).mockResolvedValue(null);
    vi.mocked(fetchEvents)
      .mockResolvedValueOnce({ data: [makeEvent('e1')], hasMore: true, nextCursor: 'c2' })
      .mockResolvedValueOnce({ data: [makeEvent('e2')], hasMore: false, nextCursor: null });
    vi.mocked(bulkInsert).mockResolvedValue(1);
    vi.mocked(saveCheckpoint).mockResolvedValue();

    await runWorker();

    expect(fetchEvents).toHaveBeenCalledTimes(2);
  });

  it('returns total events inserted', async () => {
    vi.mocked(loadCheckpoint).mockResolvedValue(null);
    vi.mocked(fetchEvents)
      .mockResolvedValueOnce({ data: [makeEvent('e1'), makeEvent('e2')], hasMore: true, nextCursor: 'c2' })
      .mockResolvedValueOnce({ data: [makeEvent('e3')], hasMore: false, nextCursor: null });
    vi.mocked(bulkInsert)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    vi.mocked(saveCheckpoint).mockResolvedValue();

    const total = await runWorker();
    expect(total).toBe(3);
  });
});
