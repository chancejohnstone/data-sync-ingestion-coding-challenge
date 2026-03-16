import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pool, query } from './db';
import { runMigrations } from './schema';
import { loadCheckpoint, saveCheckpoint } from './checkpoint';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await query('DELETE FROM ingestion_progress');
});

afterAll(async () => {
  await pool.end();
});

describe('loadCheckpoint', () => {
  it('returns null on fresh database', async () => {
    const result = await loadCheckpoint();
    expect(result).toBeNull();
  });

  it('returns saved checkpoint after saveCheckpoint', async () => {
    await saveCheckpoint('cursor-abc', 500);
    const result = await loadCheckpoint();
    expect(result).toEqual({ cursor: 'cursor-abc', eventsIngested: 500 });
  });
});

describe('saveCheckpoint', () => {
  it('upserts — repeated saves update not duplicate', async () => {
    await saveCheckpoint('cursor-1', 100);
    await saveCheckpoint('cursor-2', 200);
    const result = await loadCheckpoint();
    expect(result).toEqual({ cursor: 'cursor-2', eventsIngested: 200 });
    const count = await query('SELECT COUNT(*) FROM ingestion_progress');
    expect(parseInt(count.rows[0].count, 10)).toBe(1);
  });
});
