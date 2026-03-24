import { runWorker, WorkerMetrics } from './worker';
import { query } from './db';

const TARGET_EVENT_COUNT = parseInt(process.env.TARGET_EVENT_COUNT ?? '3000000', 10);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);
const PROGRESS_INTERVAL_MS = 10_000;

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8); // HH:MM:SS
}

export async function runCoordinator(): Promise<void> {
  const startTime = Date.now();
  let totalInserted = 0;

  const sharedMetrics: WorkerMetrics = { errors: 0, pagesProcessed: 0, lastCursorAge: 0 };

  console.log(`[${formatTime(new Date())}] Starting ingestion with ${CONCURRENCY} workers`);

  // Progress reporter — reads live count from DB checkpoint
  const progressInterval = setInterval(async () => {
    try {
      const result = await query<{ events_ingested: number }>(
        'SELECT events_ingested FROM ingestion_progress WHERE id = 1'
      );
      const liveCount = result.rows[0]?.events_ingested ?? totalInserted;
      const elapsed = (Date.now() - startTime) / 60_000;
      const eventsPerMin = elapsed > 0 ? Math.round(liveCount / elapsed) : 0;
      const logMetrics = {
        timestamp: new Date().toISOString(),
        eventsIngested: liveCount,
        target: TARGET_EVENT_COUNT,
        pctComplete: ((liveCount / TARGET_EVENT_COUNT) * 100).toFixed(1),
        throughputEventsPerMin: eventsPerMin,
        etaMinutes: eventsPerMin > 0 ? ((TARGET_EVENT_COUNT - liveCount) / eventsPerMin).toFixed(1) : null,
        errors: sharedMetrics.errors,
        pagesProcessed: sharedMetrics.pagesProcessed,
        cursorAgeSec: Math.round(sharedMetrics.lastCursorAge),
      };
      console.log(JSON.stringify(logMetrics));
      console.log(
        `[${formatTime(new Date())}] ${liveCount.toLocaleString()} / ${TARGET_EVENT_COUNT.toLocaleString()} ` +
        `(${eventsPerMin.toLocaleString()} ev/min | ETA: ${logMetrics.etaMinutes}min | errors: ${sharedMetrics.errors})`
      );
    } catch {
      // DB not ready yet — skip this tick
    }
  }, PROGRESS_INTERVAL_MS);

  try {
    // Launch CONCURRENCY workers concurrently
    // Workers share the same checkpoint table — each picks up where it left off
    // In practice with a single cursor API, workers will coordinate via the checkpoint
    const workerPromises: Promise<number>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workerPromises.push(
        runWorker(sharedMetrics).then((count) => {
          totalInserted += count;
          return count;
        })
      );
    }

    await Promise.all(workerPromises);
  } finally {
    clearInterval(progressInterval);
  }

  const elapsed = (Date.now() - startTime) / 60_000;
  const finalRate = elapsed > 0 ? Math.round(totalInserted / elapsed) : 0;

  const summary = {
    status: 'complete',
    totalEvents: totalInserted,
    elapsedMinutes: elapsed.toFixed(1),
    avgEventsPerMin: finalRate,
    totalErrors: sharedMetrics.errors,
    totalPages: sharedMetrics.pagesProcessed,
  };
  console.log(JSON.stringify(summary));
  console.log('ingestion complete');
}
