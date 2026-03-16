import { query } from './db';

export async function runMigrations(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ingested_events (
      id TEXT PRIMARY KEY,
      event_type TEXT,
      timestamp TIMESTAMPTZ,
      payload JSONB,
      ingested_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ingestion_progress (
      id INT PRIMARY KEY DEFAULT 1,
      cursor TEXT,
      events_ingested INT DEFAULT 0,
      cursor_refreshed_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
