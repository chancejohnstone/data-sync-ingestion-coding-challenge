import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, query } from './db';
import { runMigrations } from './schema';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await pool.end();
});

describe('runMigrations', () => {
  it('creates ingested_events table', async () => {
    const result = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ingested_events'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('creates ingestion_progress table', async () => {
    const result = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ingestion_progress'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('is idempotent — safe to call twice', async () => {
    await expect(runMigrations()).resolves.not.toThrow();
  });
});
