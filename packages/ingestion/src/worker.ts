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
    if (cursor && isCursorStale(cursorRefreshedAt, threshold)) {
      try {
        const refresh = await fetchEvents(cursor, 1);
        if (refresh.nextCursor) {
          cursor = refresh.nextCursor;
          cursorRefreshedAt = new Date();
          console.log('[worker] Proactive cursor keep-alive succeeded');
        }
      } catch (err) {
        if (err instanceof CursorExpiredError) {
          console.warn('[worker] Cursor expired during proactive keep-alive, restarting from null cursor');
          cursor = null;
          cursorRefreshedAt = null;
          if (metrics) metrics.errors += 1;
        }
        // 429s retried automatically by axios interceptor
      }
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

    cursor = response.nextCursor;
    if (cursor) {
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

    // Dynamic rate limit pacing: burst until budget exhausted, then sleep the reset window
    if (response.rateLimitRemaining !== null && response.rateLimitRemaining <= 0) {
      const resetMs = (response.rateLimitReset ?? 60) * 1000;
      const responseReceivedAt = Date.now();

      // Prevent cursor expiry during sleep: if the cursor would expire before the
      // rate-limit window resets, make a keep-alive request before that happens.
      const cursorLifeMs = (response.cursorExpiresIn ?? Infinity) * 1000;
      const cursorAgeMs = cursorRefreshedAt ? responseReceivedAt - cursorRefreshedAt.getTime() : 0;
      const cursorRemainingMs = cursorLifeMs - cursorAgeMs;
      const KEEP_ALIVE_BUFFER_MS = 15_000;

      if (isFinite(cursorRemainingMs) && resetMs > cursorRemainingMs - KEEP_ALIVE_BUFFER_MS) {
        const preSleepMs = Math.max(0, cursorRemainingMs - KEEP_ALIVE_BUFFER_MS);
        if (preSleepMs > 0) {
          console.log(`[worker] Rate limit: sleeping ${preSleepMs}ms before cursor keep-alive`);
          await sleep(preSleepMs);
        }
        console.log('[worker] Cursor keep-alive: refreshing before expiry');
        try {
          const keepAlive = await fetchEvents(cursor, 1);
          if (keepAlive.nextCursor) {
            cursor = keepAlive.nextCursor;
            cursorRefreshedAt = new Date();
            console.log('[worker] Cursor refreshed via keep-alive');
          }
        } catch (keepAliveErr) {
          if (keepAliveErr instanceof CursorExpiredError) {
            console.warn('[worker] Cursor expired during keep-alive, resetting');
            cursor = null;
            cursorRefreshedAt = null;
            if (metrics) metrics.errors += 1;
          }
          // 429s are retried automatically by the axios interceptor
        }
        const elapsed = Date.now() - responseReceivedAt;
        const remainingMs = Math.max(0, resetMs - elapsed);
        if (remainingMs > 0) {
          console.log(`[worker] Sleeping remaining ${remainingMs}ms after keep-alive`);
          await sleep(remainingMs);
        }
      } else {
        console.log(`[worker] Rate limit exhausted, sleeping ${resetMs}ms`);
        await sleep(resetMs);
      }
    }
  }

  return totalInserted;
}
