# DataSync Ingestion Service — Solution

## How to Run

```bash
sh run-ingestion.sh
```

Starts all Docker services and waits for ingestion to complete. No manual steps required.

**Prerequisites:** Docker + Docker Compose installed.

## Architecture Overview

```
run-ingestion.sh
    └── docker compose up -d --build
            ├── postgres:16-alpine         (provided)
            └── assignment-ingestion       (this service)
                    └── src/main.ts
                            ├── validateEnv()       — check required env vars
                            ├── runMigrations()     — idempotent schema setup
                            └── runCoordinator()    — spawn N concurrent workers
                                    └── runWorker() × WORKER_CONCURRENCY
                                            ├── loadCheckpoint()   — resume cursor
                                            ├── fetchEvents()      — paginated API
                                            ├── bulkInsert()       — batch upsert
                                            └── saveCheckpoint()   — persist progress
```

**Resumable:** On restart, each worker calls `loadCheckpoint()` and resumes from the last saved cursor. Duplicate events are discarded via `ON CONFLICT (id) DO NOTHING`.

**Rate limit handling:** Response interceptor parses `X-RateLimit-*` headers. 429 responses trigger exponential backoff (1s → 2s → 4s, capped at 30s).

## API Discoveries

*[To be filled in after live API exploration]*

Key questions answered during discovery:
- Maximum supported `limit` parameter
- Bulk/stream endpoints (if any)
- Cursor TTL and format
- Rate limit numbers
- Undocumented response headers

## What I Would Improve with More Time

1. **Segment-based parallelism** — assign each worker a non-overlapping data segment instead of a shared cursor
2. **Streaming parser** — ndjson streaming to reduce memory pressure on large pages
3. **Adaptive concurrency** — scale workers up/down based on observed throughput
4. **Circuit breaker** — pause all workers on sustained error rate spike
5. **Prometheus metrics** — expose `/metrics` endpoint for real-time scraping

## AI Tools Used

Built entirely with **Claude Code** (Anthropic's CLI agent, Claude Sonnet 4.6).

See `packages/SOLUTION_README.md` for full documentation of how Claude Code was used, including:
- Wave-based parallel agent execution (5 development waves, ~10 min total)
- TDD enforcement across all modules (35 unit tests)
- GitHub milestone and issue automation
- Self-correcting behavior (vitest config debugging)
