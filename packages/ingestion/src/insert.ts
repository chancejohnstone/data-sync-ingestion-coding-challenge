import { query } from './db';
import { normalizeTimestamp } from './normalize';
import type { EventRecord } from './api';

export async function bulkInsert(events: EventRecord[]): Promise<number> {
  if (events.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  events.forEach((event, i) => {
    const base = i * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(
      event.id,
      event.event_type,
      normalizeTimestamp(event.timestamp),
      JSON.stringify(event.payload)
    );
  });

  const sql = `
    INSERT INTO ingested_events (id, event_type, timestamp, payload)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (id) DO NOTHING
  `;

  const result = await query(sql, values);
  return result.rowCount ?? 0;
}
