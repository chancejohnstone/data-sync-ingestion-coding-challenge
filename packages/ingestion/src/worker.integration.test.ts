import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import nock from 'nock';
import { pool, query } from './db';
import { runMigrations } from './schema';
import { saveCheckpoint, loadCheckpoint } from './checkpoint';

// Skip all tests if DATABASE_URL not set (no real PG available)
const HAS_DB = !!process.env.DATABASE_URL;
const API_BASE = process.env.API_BASE_URL ?? 'http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1';
const API_HOST = new URL(API_BASE).origin;
const API_PATH = new URL(API_BASE).pathname;

const makeEvent = (id: string) => ({
  id,
  event_type: 'test_event',
  timestamp: '2024-01-15T10:30:00.000Z',
  payload: { source: 'test' },
});

beforeAll(async () => {
  if (!HAS_DB) return;
  process.env.TARGET_API_KEY = 'test-key';
  await runMigrations();
  nock.disableNetConnect();
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await query('DELETE FROM ingested_events');
  await query('DELETE FROM ingestion_progress');
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(async () => {
  if (!HAS_DB) return;
  nock.enableNetConnect();
  await pool.end();
});

describe.skipIf(!HAS_DB)('worker integration', () => {
  it('inserts all events across 3 pages and stops on hasMore=false', async () => {
    const { runWorker } = await import('./worker');

    nock(API_HOST)
      .get(`${API_PATH}/events`).query(true)
      .reply(200, { data: [makeEvent('e1'), makeEvent('e2')], hasMore: true, nextCursor: 'c2' }, {})
      .get(`${API_PATH}/events`).query(true)
      .reply(200, { data: [makeEvent('e3'), makeEvent('e4')], hasMore: true, nextCursor: 'c3' }, {})
      .get(`${API_PATH}/events`).query(true)
      .reply(200, { data: [makeEvent('e5')], hasMore: false, nextCursor: null }, {});

    const total = await runWorker();
    expect(total).toBe(5);

    const result = await query('SELECT COUNT(*) FROM ingested_events');
    expect(parseInt(result.rows[0].count, 10)).toBe(5);
  });

  it('advances cursor in ingestion_progress each page', async () => {
    const { runWorker } = await import('./worker');

    nock(API_HOST)
      .get(`${API_PATH}/events`).query(true)
      .reply(200, { data: [makeEvent('f1')], hasMore: true, nextCursor: 'page-2' }, {})
      .get(`${API_PATH}/events`).query(true)
      .reply(200, { data: [makeEvent('f2')], hasMore: false, nextCursor: null }, {});

    await runWorker();

    const cp = await loadCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp!.eventsIngested).toBe(2);
  });

  it('resumes from seeded checkpoint cursor (skips page 1)', async () => {
    const { runWorker } = await import('./worker');

    // Seed a mid-run checkpoint
    await saveCheckpoint('resume-cursor', 10);

    nock(API_HOST)
      .get(`${API_PATH}/events`).query((q) => q.cursor === 'resume-cursor')
      .reply(200, { data: [makeEvent('r1'), makeEvent('r2')], hasMore: false, nextCursor: null }, {});

    const total = await runWorker();
    // Returns accumulated total: 10 (existing) + 2 (new)
    expect(total).toBe(12);
  });

  it('retries after a 429 response', async () => {
    const { runWorker } = await import('./worker');

    nock(API_HOST)
      .get(`${API_PATH}/events`).query(true)
      .reply(429, 'Too Many Requests', { 'retry-after': '1' })
      .get(`${API_PATH}/events`).query(true)
      .reply(200, { data: [makeEvent('rr1')], hasMore: false, nextCursor: null }, {});

    const total = await runWorker();
    expect(total).toBe(1);
  }, 15_000); // longer timeout for backoff
});
