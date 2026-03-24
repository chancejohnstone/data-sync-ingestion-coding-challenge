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

### Pagination & Limits

- **Max effective page size:** `limit=5000` (requests with `limit=10000` are silently capped and return identical payload to `limit=5000`)
- **Cursor format:** Base64-encoded JSON with `cursorExpiresIn` field (seconds)
- **Cursor TTL:** ~116 seconds; cursor expires as an absolute Unix ms timestamp in `exp` field
- **Expired cursor behavior:** Returns HTTP 502 Bad Gateway (not a 4xx error) — see `CursorExpiredError` in `src/api.ts`

### Rate Limits

| Endpoint      | Limit         | Window |
|---------------|---------------|--------|
| `/events`     | **10 req/60s** | 60s    |
| `/sessions`   | 40 req/60s    | 60s    |
| `/metrics`    | 30 req/60s    | 60s    |

Rate limit headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

### Bulk & Stream Endpoints

**Result:** No bulk or streaming endpoints exist. Probed:
- `/api/v1/events/bulk`, `/events/stream`, `/events/export`, `/events/all` → 404
- `/api/v1/bulk`, `/api/v1/stream` → 404
- `/api/v1/events/count`, `/api/v1/summary` → 502 Bad Gateway

### Undocumented Features & Endpoints

1. **`/sessions` endpoint** — Cursor-based pagination (same structure as `/events`), returns ~60,000 sessions with `eventCount` field per session. Rate limit 4x higher (40/60s vs. 10/60s).

2. **`?sessionId=<uuid>` filter on `/events`** — Filters events by session; enables per-session retrieval (though rate limit still applies).

3. **`/metrics` endpoint** — Currently empty; not useful for ingestion.

4. **`X-Cache` headers** — Responses cached for 30 seconds (`X-Cache-TTL: 30`). Identical requests within 30s return `X-Cache: HIT` and do not consume (or consume fewer) rate limit tokens.

### Data Format Issues

- **Timestamps:** Events use two mixed formats on the same page:
  - Unix milliseconds: `{"timestamp": 1769541612369}`
  - ISO 8601 string: `{"timestamp": "2026-01-27T19:19:13.629Z"}`
  - Must normalize both to `TIMESTAMPTZ` when storing to PostgreSQL

### Optimal Ingestion Strategy

With a single API key and the 10 req/60s rate limit on `/events`:

- Use **`limit=5000`** (maximum effective limit)
- 3,000,000 ÷ 5,000 = 600 pages minimum
- At 10 req/60s = **~6 seconds between requests**
- **Total throughput: ~60 minutes** for full ingestion (within 90-minute API key TTL)
- **Single worker** is optimal (higher concurrency doesn't improve throughput; rate limit is binding constraint)
- Checkpoint cursor after each successful page; refresh if `cursorExpiresIn < 30s` to avoid stale cursors
- On 429: back off using `Retry-After` header or exponential backoff (capped at 30s)
- On 502: cursor has expired; consider restart or resume logic

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
