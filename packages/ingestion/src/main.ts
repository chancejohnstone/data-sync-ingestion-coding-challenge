import { runMigrations } from './schema';
import { runCoordinator } from './coordinator';
import { pool } from './db';

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

  await runCoordinator();
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
