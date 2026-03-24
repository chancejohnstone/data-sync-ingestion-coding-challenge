import * as http from 'http';
import { runMigrations } from './schema';
import { runCoordinator } from './coordinator';
import { pool, query } from './db';

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'API_BASE_URL', 'TARGET_API_KEY'];

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  validateEnv();

  console.log('Running database migrations...');
  await runMigrations();
  console.log('Migrations complete.');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    await pool.end();
    process.exit(0);
  });

  // Start metrics HTTP server
  const metricsServer = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/metrics') {
      try {
        const result = await query<{ events_ingested: number }>('SELECT events_ingested FROM ingestion_progress WHERE id = 1');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ eventsIngested: result.rows[0]?.events_ingested ?? 0, target: 3000000 }));
      } catch {
        res.writeHead(503);
        res.end('{}');
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  metricsServer.listen(3000, () => console.log('Metrics server listening on :3000'));

  await runCoordinator();
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
