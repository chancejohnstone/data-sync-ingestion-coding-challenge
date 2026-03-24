import { loadCheckpoint, saveCheckpoint } from './checkpoint';
import { fetchEvents, CursorExpiredError } from './api';
import { bulkInsert } from './insert';
import { isCursorStale, getCursorThreshold } from './cursor';
import { sleep } from './ratelimit';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '100', 10);

export interface WorkerMetrics {
  errors: number;
  pagesProcessed: number;
  lastCursorAge: number; // seconds since last cursor refresh
}

export async function runWorker(metrics?: WorkerMetrics): Promise<number> {
  const checkpoint = await loadCheckpoint();
  let cursor: string | null = checkpoint?.cursor ?? null;
  let totalInserted = checkpoint?.eventsIngested ?? 0;
  let cursorRefreshedAt: Date | null = checkpoint ? new Date() : null;
  const threshold = getCursorThreshold();

  while (true) {
    if (isCursorStale(cursorRefreshedAt, threshold)) {
      cursorRefreshedAt = new Date();
    }

    let response;
    try {
      response = await fetchEvents(cursor, BATCH_SIZE);
    } catch (err) {
      if (err instanceof CursorExpiredError) {
        console.warn('[worker] Cursor expired (502), restarting from null cursor');
        cursor = null;
        cursorRefreshedAt = null;
        if (metrics) metrics.errors += 1;
        continue;
      }
      throw err;
    }

    const inserted = await bulkInsert(response.data);
    totalInserted += inserted;

    if (response.nextCursor) {
      cursor = response.nextCursor;
      cursorRefreshedAt = new Date();
    }

    await saveCheckpoint(cursor, totalInserted);

    if (metrics) {
      metrics.pagesProcessed += 1;
      if (cursorRefreshedAt) {
        metrics.lastCursorAge = (Date.now() - cursorRefreshedAt.getTime()) / 1000;
      }
    }

    if (!response.hasMore) break;

    await sleep(6000); // 10 req/60s = 1 req/6s
  }

  return totalInserted;
}
