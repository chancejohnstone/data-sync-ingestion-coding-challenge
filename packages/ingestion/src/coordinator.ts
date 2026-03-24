import { runWorker } from './worker';

const TARGET_EVENT_COUNT = parseInt(process.env.TARGET_EVENT_COUNT ?? '3000000', 10);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);
const PROGRESS_INTERVAL_MS = 10_000;

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8); // HH:MM:SS
}

export async function runCoordinator(): Promise<void> {
  const startTime = Date.now();
  let totalInserted = 0;

  console.log(`[${formatTime(new Date())}] Starting ingestion with ${CONCURRENCY} workers`);

  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 60_000; // minutes
    const eventsPerMin = elapsed > 0 ? Math.round(totalInserted / elapsed) : 0;
    console.log(
      `[${formatTime(new Date())}] Events ingested: ${totalInserted.toLocaleString()} / ${TARGET_EVENT_COUNT.toLocaleString()} (${eventsPerMin.toLocaleString()} events/min)`
    );
  }, PROGRESS_INTERVAL_MS);

  try {
    // Launch CONCURRENCY workers concurrently
    // Workers share the same checkpoint table — each picks up where it left off
    // In practice with a single cursor API, workers will coordinate via the checkpoint
    const workerPromises: Promise<number>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workerPromises.push(
        runWorker().then((count) => {
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

  console.log(`[${formatTime(new Date())}] Events ingested: ${totalInserted.toLocaleString()} / ${TARGET_EVENT_COUNT.toLocaleString()} (${finalRate.toLocaleString()} events/min)`);
  console.log('ingestion complete');
}
