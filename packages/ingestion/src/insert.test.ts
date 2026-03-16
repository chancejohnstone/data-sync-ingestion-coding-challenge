import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  query: vi.fn(),
}));

vi.mock('./normalize', () => ({
  normalizeTimestamp: vi.fn((v: string | number) => '2024-01-15T10:30:00.000Z'),
}));

import { query } from './db';
import { normalizeTimestamp } from './normalize';
import { bulkInsert } from './insert';
import type { EventRecord } from './api';

const makeEvent = (id: string): EventRecord => ({
  id,
  event_type: 'test',
  timestamp: '2024-01-15T10:30:00.000Z',
  payload: { key: 'value' },
});

describe('bulkInsert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 for empty array without calling query', async () => {
    const count = await bulkInsert([]);
    expect(count).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('calls query with INSERT ... ON CONFLICT DO NOTHING', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 2 } as any);
    await bulkInsert([makeEvent('evt-1'), makeEvent('evt-2')]);
    const sql: string = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toMatch(/INSERT INTO ingested_events/i);
    expect(sql).toMatch(/ON CONFLICT.*DO NOTHING/i);
  });

  it('calls normalizeTimestamp for each event', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    await bulkInsert([makeEvent('evt-1'), makeEvent('evt-2')]);
    expect(normalizeTimestamp).toHaveBeenCalledTimes(2);
  });

  it('returns the rowCount from query result', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 3 } as any);
    const count = await bulkInsert([makeEvent('a'), makeEvent('b'), makeEvent('c')]);
    expect(count).toBe(3);
  });

  it('returns 0 when rowCount is null (all conflicts)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: null } as any);
    const count = await bulkInsert([makeEvent('dup')]);
    expect(count).toBe(0);
  });
});
