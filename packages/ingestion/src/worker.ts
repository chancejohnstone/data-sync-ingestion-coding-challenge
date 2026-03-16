import { loadCheckpoint, saveCheckpoint } from './checkpoint';
import { fetchEvents } from './api';
import { bulkInsert } from './insert';
import { isCursorStale, getCursorThreshold } from './cursor';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '100', 10);

export async function runWorker(): Promise<number> {
  const checkpoint = await loadCheckpoint();
  let cursor: string | null = checkpoint?.cursor ?? null;
  let totalInserted = checkpoint?.eventsIngested ?? 0;
  let cursorRefreshedAt: Date | null = checkpoint ? new Date() : null;
  const threshold = getCursorThreshold();

  while (true) {
    if (isCursorStale(cursorRefreshedAt, threshold)) {
      cursorRefreshedAt = new Date();
    }

    const response = await fetchEvents(cursor, BATCH_SIZE);
    const inserted = await bulkInsert(response.data);
    totalInserted += inserted;

    if (response.nextCursor) {
      cursor = response.nextCursor;
      cursorRefreshedAt = new Date();
    }

    await saveCheckpoint(cursor, totalInserted);

    if (!response.hasMore) break;
  }

  return totalInserted;
}
