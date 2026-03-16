import { query } from './db';

export interface Checkpoint {
  cursor: string | null;
  eventsIngested: number;
}

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  const result = await query<{ cursor: string | null; events_ingested: number }>(
    'SELECT cursor, events_ingested FROM ingestion_progress WHERE id = 1'
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { cursor: row.cursor, eventsIngested: row.events_ingested };
}

export async function saveCheckpoint(cursor: string | null, eventsIngested: number): Promise<void> {
  await query(
    `INSERT INTO ingestion_progress (id, cursor, events_ingested, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET cursor = EXCLUDED.cursor,
           events_ingested = EXCLUDED.events_ingested,
           updated_at = NOW()`,
    [cursor, eventsIngested]
  );
}
