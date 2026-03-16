import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  query: vi.fn(),
}));

import { query } from './db';
import { loadCheckpoint, saveCheckpoint } from './checkpoint';

describe('loadCheckpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no row exists', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const result = await loadCheckpoint();
    expect(result).toBeNull();
  });

  it('returns cursor and eventsIngested when row exists', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ cursor: 'abc123', events_ingested: 500 }],
      rowCount: 1,
    } as any);
    const result = await loadCheckpoint();
    expect(result).toEqual({ cursor: 'abc123', eventsIngested: 500 });
  });
});

describe('saveCheckpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls query with upsert SQL including cursor and count', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    await saveCheckpoint('cursor-xyz', 1000);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ingestion_progress'),
      expect.arrayContaining(['cursor-xyz', 1000])
    );
  });

  it('upsert SQL contains ON CONFLICT DO UPDATE', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    await saveCheckpoint('cursor-abc', 2000);
    const sql: string = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toMatch(/ON CONFLICT.*DO UPDATE/i);
  });
});
