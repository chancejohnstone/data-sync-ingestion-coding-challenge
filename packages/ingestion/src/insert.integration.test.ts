import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pool, query } from './db';
import { runMigrations } from './schema';
import { bulkInsert } from './insert';
import type { EventRecord } from './api';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await query('DELETE FROM ingested_events');
});

afterAll(async () => {
  await pool.end();
});

const makeEvent = (id: string, timestamp: string | number = '2024-01-15T10:30:00.000Z'): EventRecord => ({
  id,
  event_type: 'test_event',
  timestamp,
  payload: { key: 'value' },
});

describe('bulkInsert', () => {
  it('inserts N rows and returns correct count', async () => {
    const count = await bulkInsert([makeEvent('evt-1'), makeEvent('evt-2'), makeEvent('evt-3')]);
    expect(count).toBe(3);
    const result = await query('SELECT COUNT(*) FROM ingested_events');
    expect(parseInt(result.rows[0].count, 10)).toBe(3);
  });

  it('duplicate IDs are silently ignored (ON CONFLICT DO NOTHING)', async () => {
    await bulkInsert([makeEvent('dup-1')]);
    const count = await bulkInsert([makeEvent('dup-1'), makeEvent('new-1')]);
    expect(count).toBe(1); // only new-1 inserted
    const result = await query('SELECT COUNT(*) FROM ingested_events');
    expect(parseInt(result.rows[0].count, 10)).toBe(2); // dup-1 + new-1
  });

  it('stores timestamps as UTC regardless of input format', async () => {
    // Unix seconds — should be stored as UTC ISO
    await bulkInsert([makeEvent('ts-unix', 1705315800)]);
    const result = await query("SELECT timestamp FROM ingested_events WHERE id = 'ts-unix'");
    expect(result.rows[0].timestamp).toBeInstanceOf(Date);
    expect(result.rows[0].timestamp.toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });

  it('stores ISO with offset as UTC', async () => {
    await bulkInsert([makeEvent('ts-offset', '2024-01-15T15:30:00.000+05:00')]);
    const result = await query("SELECT timestamp FROM ingested_events WHERE id = 'ts-offset'");
    expect(result.rows[0].timestamp.toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });
});
