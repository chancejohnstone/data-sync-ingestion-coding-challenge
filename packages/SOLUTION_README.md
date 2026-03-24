# DataSync Ingestion Service

A TypeScript/Node.js service that extracts 3,000,000 events from the DataSync Analytics API and stores them in PostgreSQL. Runs fully automated via Docker.

## How to Run

```bash
sh run-ingestion.sh
```

This builds the Docker image, starts all services, and polls until ingestion is complete.

**Prerequisites:** Docker + Docker Compose. No other dependencies.

## Architecture

```
run-ingestion.sh
    └── docker compose up -d --build
            ├── postgres:16-alpine       (provided)
            └── assignment-ingestion     (this service)
                    └── main.ts
                            ├── validateEnv()         — check required vars
                            ├── runMigrations()        — idempotent schema setup
                            └── runCoordinator()       — spawn N concurrent workers
                                    └── runWorker() × WORKER_CONCURRENCY
                                            ├── loadCheckpoint()   — resume cursor
                                            ├── fetchEvents()      — paginated API
                                            ├── bulkInsert()       — batch upsert
                                            └── saveCheckpoint()   — persist progress
```

### Key Components

| File | Responsibility |
|------|---------------|
| `main.ts` | Entry point — env validation, migrations, graceful shutdown |
| `coordinator.ts` | Spawns N workers, aggregates progress, logs `"ingestion complete"` |
| `worker.ts` | Single fetch→insert→checkpoint loop with cursor lifecycle management |
| `api.ts` | Axios client — `X-API-Key` header auth, 429 backoff interceptor |
| `ratelimit.ts` | Parse rate limit headers, exponential backoff, adaptive throttle |
| `cursor.ts` | Cursor staleness detection (age vs `CURSOR_REFRESH_THRESHOLD`) |
| `insert.ts` | Parameterized bulk `INSERT ... ON CONFLICT (id) DO NOTHING` |
| `checkpoint.ts` | Upsert-based progress persistence in `ingestion_progress` table |
| `normalize.ts` | Timestamp normalization (ISO, Unix seconds, Unix ms → UTC ISO) |
| `schema.ts` | `CREATE TABLE IF NOT EXISTS` migrations |
| `db.ts` | pg Pool from `DATABASE_URL`, graceful SIGTERM shutdown |

### Database Schema

```sql
-- Ingested events (primary store)
CREATE TABLE ingested_events (
  id TEXT PRIMARY KEY,
  event_type TEXT,
  timestamp TIMESTAMPTZ,
  payload JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

-- Single-row progress checkpoint (id = 1)
CREATE TABLE ingestion_progress (
  id INT PRIMARY KEY DEFAULT 1,
  cursor TEXT,
  events_ingested INT DEFAULT 0,
  cursor_refreshed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Resumability

On startup, `worker.ts` calls `loadCheckpoint()`. If a row exists in `ingestion_progress`, it resumes from the saved cursor. If the container crashes and restarts, ingestion picks up from the last saved position with no duplicate events (enforced by `ON CONFLICT (id) DO NOTHING`).

### Rate Limit Handling

- Response interceptor parses `X-RateLimit-Remaining` and `Retry-After` headers
- 429 responses trigger exponential backoff: 1s → 2s → 4s → … capped at 30s
- When `Remaining < 10`, an adaptive pre-request delay is applied

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `API_BASE_URL` | required | DataSync API base URL |
| `TARGET_API_KEY` | required | API authentication key |
| `WORKER_CONCURRENCY` | `5` | Number of parallel workers |
| `BATCH_SIZE` | `100` | Events per API page |
| `CURSOR_REFRESH_THRESHOLD` | `60` | Seconds before cursor considered stale |

## Tests

```bash
# Unit tests (no external dependencies)
npm test

# Integration tests (requires running PostgreSQL)
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ingestion npm run test:integration
```

**Unit test coverage:** 35 tests across normalize, ratelimit, cursor, api, checkpoint, insert, worker modules. All dependencies mocked — runs without any external services.

**Integration test coverage:** schema idempotency, checkpoint round-trips, bulk insert with conflict handling, full worker pipeline with mock HTTP + real Postgres.

## API Discoveries

*This section will be filled in after Wave 5 (API discovery) completes.*

Known from documentation:
- Auth: `X-API-Key` header (preferred over query param — affects rate limits)
- Pagination: `GET /events?limit=N&cursor=...` → `{ data, hasMore, nextCursor }`
- Cursors have a TTL — must be refreshed before `CURSOR_REFRESH_THRESHOLD` seconds

Discoveries pending:
- Maximum supported `limit` value
- Bulk/stream endpoints beyond `/events`
- Parallel segment support
- ndjson streaming support

## Attempted Optimization (Did Not Work as Intended)

After the initial solution was complete, an optimized variant was developed to try to push throughput higher. The approach and what went wrong:

### What Was Tried

**`run-ingestion-optimized.sh`** sets `BATCH_SIZE=5000`, `WORKER_CONCURRENCY=1`, and `CURSOR_REFRESH_THRESHOLD=90`, then starts the same Docker stack.

The worker loop was extended with two optimizations:

1. **Dynamic rate-limit pacing** — instead of a fixed backoff on every request, the worker bursts at full speed until `X-RateLimit-Remaining` reaches 0, then sleeps exactly `X-RateLimit-Reset` seconds. This maximizes the number of requests per rate-limit window.

2. **Cursor keep-alive during rate-limit sleep** — when sleeping for a rate-limit reset, if the cursor TTL would expire before the sleep window ends, the worker fires a lightweight `limit=1` fetch first to refresh the cursor, then sleeps the remainder. This prevents the cursor from expiring mid-sleep and forcing a re-scan from `cursor=null`.

### What Went Wrong

**The rate-limit sleep did fire** (`[worker] Rate limit exhausted, sleeping 32000ms`) after a fast burst of ~740,000 events. During the sleep, `eventsIngested` appeared stalled in the metrics log — it hadn't actually stalled, the cursor was advancing through pages, but no *net new* inserts were happening because those pages contained events already in the database from a prior run.

Three bugs were found and fixed during debugging:

| Bug | Symptom | Fix |
|-----|---------|-----|
| Cursor not updated when `nextCursor: null` | After completing a run with `hasMore: false`, checkpoint saved the second-to-last cursor, causing every re-run to re-fetch the last page and exit — stuck at 740k forever | Always assign `cursor = response.nextCursor` (even when null) |
| Stale-cursor check was a no-op | `isCursorStale()` fired but only reset the timer, never made a keep-alive request — cursors expired silently during long rate-limit sleep sequences | Actually call `fetchEvents(cursor, 1)` in the stale-cursor branch |
| `rateLimitRemaining ?? 1` false trigger | When the API omitted rate-limit headers, the fallback `1 <= 1` evaluated true and triggered an unnecessary sleep on every page | Changed to `!== null && <= 0` |

Despite these fixes, the optimized version still did not complete a full 3M-event run reliably within testing, so it was not submitted. The working solution is `run-ingestion.sh`.

---

## What I'd Improve with More Time

1. **Segment-based parallelism** — if the API supports range/segment queries, assign each worker a non-overlapping segment instead of coordinating through a shared checkpoint
2. **Streaming parser** — if ndjson is available, stream-parse responses to reduce memory pressure on large pages
3. **Prometheus metrics endpoint** — expose `/metrics` inside the container for real-time scraping
4. **Circuit breaker** — if error rate spikes, pause all workers and alert rather than hammering a degraded API
5. **Adaptive concurrency** — dynamically scale workers up/down based on observed throughput and error rate

---

## AI Tooling: How Claude Code Was Used

This entire solution was designed and implemented using **Claude Code** (Anthropic's CLI coding agent, powered by Claude Sonnet 4.6). Here's a detailed account of how it was used.

### Planning Phase

Before writing a single line of code, Claude Code was used in **Plan Mode** to:

1. **Analyze the challenge requirements** — read the CLAUDE.md spec, the existing docker-compose.yml, and the run-ingestion.sh script
2. **Explore the API structure** — assessed what was known from documentation and what needed discovery
3. **Design a wave-based parallel execution strategy** — decomposed the work into 5 sequential waves with independent tasks within each wave that could run simultaneously
4. **Create a 90-minute clock strategy** — identified that the API key timer starts on first use, so all code should be written and validated *before* touching the API

The output was a detailed plan saved to `~/.claude/plans/concurrent-swinging-porcupine.md` covering every implementation issue, its dependencies, which wave it belonged to, and estimated wall-clock time with parallel agents.

### GitHub Issue Tracking

Before any implementation, Claude Code used the `github-cli` skill to:
- Create **9 GitHub milestones** (one per wave, including "Nice to Have")
- Create **22 GitHub issues** with proper dependency links, acceptance criteria checklists, and wave labels
- All issues were automatically closed with completion comments as each task finished

### Implementation: Parallel Subagent Execution

The core innovation was **wave-based parallel agent dispatch**. Within each wave, all independent tasks were dispatched simultaneously as background subagents. Each agent received:
- Exact file paths to create
- Full implementation (TDD tests first, then implementation)
- Commit message format
- GitHub issue close instructions

Wave execution times:
| Wave | Tasks | Wall-clock |
|------|-------|------------|
| Wave 0 | 1 (scaffold) | ~1.5 min |
| Wave 1 | 6 parallel (db, schema, normalize, api+ratelimit, cursor, docker) | ~2 min |
| Wave 2 | 2 parallel (checkpoint, insert) + 1 sequential (integration tests) | ~2 min |
| Wave 3 | 2 parallel (worker + worker integration test) | ~2 min |
| Wave 4 | 2 parallel (coordinator + entry point) | ~1.5 min |
| **Total** | **15 issues** | **~10 min** |

### Test-Driven Development

Every module with logic was built TDD-first:
- Claude Code agents wrote failing tests *before* any implementation
- Ran `npm test` to confirm RED state
- Implemented the minimal code to pass
- Confirmed GREEN state before committing

This was enforced by the agent prompts which explicitly instructed the RED→GREEN sequence and included the test file content alongside the implementation.

### Self-Correcting Behavior

One notable moment: after Wave 2, running `npm test` revealed that vitest was picking up compiled `.js` test files from `dist/` AND integration test files (because Windows doesn't handle single-quote glob patterns in npm scripts). Claude Code diagnosed this, created a `vitest.config.ts` with proper `include`/`exclude` patterns, committed the fix, and re-verified before proceeding to Wave 3.

### Skills Used

Claude Code has a "skills" system — reusable workflow prompts that guide specific tasks:

| Skill | Used for |
|-------|----------|
| `superpowers:writing-plans` | Designing the wave-based implementation plan |
| `superpowers:executing-plans` | Orchestrating wave execution |
| `superpowers:subagent-driven-development` | Dispatching parallel implementer + reviewer agents |
| `superpowers:using-git-worktrees` | Isolating feature work on `feature/ingestion` branch |
| `superpowers:test-driven-development` | Enforcing RED→GREEN in each agent prompt |
| `github-cli` | Creating milestones, issues, and closing them on completion |
| `api-dashboard-explorer` | Planned for Wave 5 (API discovery) |

### What Claude Code Did vs. What I Did

| Task | Who |
|------|-----|
| Architecture design | Claude Code (Plan Mode) |
| GitHub milestone + issue creation | Claude Code (github-cli skill) |
| All TypeScript implementation | Claude Code (subagents) |
| TDD test writing | Claude Code (subagents) |
| Vitest config debugging | Claude Code (main session) |
| Git commits and branch management | Claude Code (subagents + main) |
| API key provision | Human (Wave 5 touchpoint) |
| Submission approval | Human (Wave 7 touchpoint, max 5 attempts) |

The design intentionally minimized human touchpoints to **2**: providing the API key and approving the final submission.
