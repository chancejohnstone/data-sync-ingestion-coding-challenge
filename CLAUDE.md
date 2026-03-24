# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A coding challenge to build a TypeScript data ingestion system that extracts 3,000,000 events from the DataSync Analytics API and stores them in PostgreSQL. The repo is a blank template — the solution must be built from scratch.

## Running the Solution

```bash
sh run-ingestion.sh
```

This starts all Docker services (`docker compose up -d --build`), then polls until:
- The `ingested_events` table in PostgreSQL reaches the target count
- The `assignment-ingestion` container logs the string `"ingestion complete"`

Both conditions are **required** — your ingestion service must log exactly `"ingestion complete"` when done.

## Infrastructure

PostgreSQL 16 is provided via `docker-compose.yml`:
- Host: `localhost:5434` (external) / `postgres:5432` (Docker internal)
- DB: `ingestion`, User: `postgres`, Password: `postgres`
- Network: `assignment-network`

Your ingestion service must be added to `docker-compose.yml` under the commented-out example. Convention: container name `assignment-ingestion`, placed in `packages/` directory.

## Solution Structure

```
packages/
  ingestion/          # Your TypeScript service
    Dockerfile
    package.json
    src/
```

## API

- **Base URL:** `http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1`
- **Auth:** `X-API-Key: <key>` header (preferred over query param — affects rate limits)
- **Events endpoint:** `GET /api/v1/events?limit=N&cursor=...`
- **Response:** `{ data: [...], hasMore: bool, nextCursor: string }`
- **Rate limits:** Communicated via response headers — check them carefully

### Critical API Notes

- API key is valid **90 minutes from first use** — timer starts on first request
- **Cursors have a lifecycle** — they can go stale; refresh before `CURSOR_REFRESH_THRESHOLD` seconds
- The documented API is **intentionally minimal** — explore the dashboard and response headers for undocumented capabilities
- The documented endpoint may not be the fastest ingestion path — investigate alternatives
- Timestamp formats vary across responses — normalize carefully

### Submission

```bash
# Submit event IDs (one per line) after ingestion
curl -X POST \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary @event_ids.txt \
  "http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1/submissions?github_repo=REPO_URL"
```

Maximum **5 submissions** per API key.

## Environment Variables

Copy `.env.example` to `.env`. Key variables:
- `TARGET_API_KEY` — assigned by interviewer
- `WORKER_CONCURRENCY` — concurrent workers (default: 5)
- `BATCH_SIZE` — events per page (default: 100)
- `CURSOR_REFRESH_THRESHOLD` — seconds before cursor expiry to refresh

Inside Docker, use `postgres:5432` (not `localhost:5434`) for `DATABASE_URL`.

## Architecture Requirements

- **TypeScript** codebase, Node.js 20+
- **Resumable**: track progress in PostgreSQL so a crash resumes from last checkpoint
- **Rate limit handling**: back off on 429s, respect header limits
- **Throughput**: primary evaluation metric (60% of score) — maximize events/minute
- Must run fully automated — no manual steps, no external services beyond what's in Docker
