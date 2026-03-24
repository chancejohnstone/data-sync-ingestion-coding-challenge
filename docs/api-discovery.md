# API Discovery Findings

**Discovered:** 2026-03-23
**API Base URL:** `http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1`
**Auth:** `X-API-Key` header (preferred over query param — affects rate limits)

---

## 1. Total Event Count

From `meta.total` on any `/events` response:

```
total: 3,000,000
```

Confirmed via: `GET /api/v1/events?limit=1` → `{"meta":{"total":3000000,"returned":1,...}}`

---

## 2. Endpoints Discovered

### From API Root (`GET /api/v1`)

The root returns a manifest revealing three endpoints:

```json
{
  "name": "DataSync Analytics API",
  "version": "v1",
  "endpoints": {
    "events":   "/api/v1/events",
    "sessions": "/api/v1/sessions",
    "metrics":  "/api/v1/metrics"
  },
  "authentication": { "method": "API Key", "header": "X-API-Key" }
}
```

`/sessions` and `/metrics` are **undocumented** in the original `docs/api.md`.

### `/api/v1/events` — Primary endpoint

- Cursor-based pagination
- Max effective page size: **5,000** (limit=10000 returns same 1,732,547 bytes as limit=5000)
- Supports `?sessionId=<uuid>` filter (returns only events for that session)
- Rate limit: **10 requests / 60 seconds**

### `/api/v1/sessions` — Undocumented

- Cursor-based pagination, same structure as /events
- Max effective page size: **5,000**
- Rate limit: **40 requests / 60 seconds** (4x higher than /events)
- Total sessions: **60,000**
- Each session object has an `eventCount` field
- Sessions average ~50 events each (3,000,000 events / 60,000 sessions)

### `/api/v1/metrics` — Undocumented (but empty)

```json
{"data":[],"pagination":{"limit":100,"hasMore":false,"nextCursor":null,"cursorExpiresIn":null},"meta":{"total":0,"returned":0}}
```

Rate limit: **30 requests / 60 seconds**. Currently returns no data — not useful for ingestion.

---

## 3. Rate Limits by Endpoint

| Endpoint    | X-RateLimit-Limit | Window |
|-------------|-------------------|--------|
| `/events`   | **10 req/60s**    | 60s    |
| `/sessions` | **40 req/60s**    | 60s    |
| `/metrics`  | **30 req/60s**    | 60s    |

Rate limit headers on every response:
- `X-RateLimit-Limit` — max requests per window
- `X-RateLimit-Remaining` — remaining in current window
- `X-RateLimit-Reset` — seconds until window resets
- `Retry-After` — seconds to wait on 429

---

## 4. Response Headers (Full Set)

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
X-Powered-By: Express
Access-Control-Allow-Origin: *
X-Request-ID: <uuid>
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 60
X-Cache: MISS | HIT
X-Cache-TTL: 30
ETag: W/"..."
```

Key observations:
- **`X-Cache`** and **`X-Cache-TTL: 30`** — responses are cached for 30 seconds. Repeated identical requests within 30s return `HIT` and don't count toward (or cost fewer) rate limit tokens.
- **`X-Request-ID`** — unique per request, useful for debugging.
- No `X-Total-Count` header — total count only comes from `meta.total` in the body.

---

## 5. Pagination & Cursor Format

### Pagination structure (inside response body)

```json
{
  "pagination": {
    "limit": 100,
    "hasMore": true,
    "nextCursor": "<base64>",
    "cursorExpiresIn": 116
  },
  "meta": {
    "total": 3000000,
    "returned": 100,
    "requestId": "<uuid>"
  }
}
```

### Cursor format

Cursors are **base64-encoded JSON**:

```json
{
  "id": "af5c33c8-8aac-4aa0-9448-b07b52ddaf9f",
  "ts": 1769540656330,
  "v": 2,
  "exp": 1774311516073
}
```

- `id` — UUID of the last event on the page (position marker)
- `ts` — Unix timestamp (ms) of that event
- `v` — version (2)
- `exp` — absolute expiry Unix timestamp (ms)

### Cursor TTL

- `cursorExpiresIn: 116` seconds (just under 2 minutes)
- `exp` field confirms expiry as absolute ms timestamp
- Bad/expired cursor → **502 Bad Gateway** (not a 4xx — watch for this)
- A cursor that is fresh works correctly across requests

**Implication:** With 10 req/60s rate limit and ~2-minute cursor TTL, cursors don't expire during normal sequential pagination. But at high concurrency or after pauses, cursors can go stale.

---

## 6. Bulk / Stream Endpoint Probe Results

| URL Probed                | Result |
|---------------------------|--------|
| `/api/v1/events/bulk`     | 404 — treated as event ID lookup `EVENT_NOT_FOUND` |
| `/api/v1/events/stream`   | 404 — treated as event ID lookup `EVENT_NOT_FOUND` |
| `/api/v1/events/export`   | 404 — treated as event ID lookup `EVENT_NOT_FOUND` |
| `/api/v1/events/all`      | 404 — treated as event ID lookup `EVENT_NOT_FOUND` |
| `/api/v1/bulk`            | 404 — `ENDPOINT_NOT_FOUND` |
| `/api/v1/stream`          | 404 — `ENDPOINT_NOT_FOUND` |
| `/api/v1/events/count`    | 502 Bad Gateway |
| `/api/v1/summary`         | 502 Bad Gateway |
| `/api/v1/stats`           | 404 — `ENDPOINT_NOT_FOUND` |

No bulk or streaming endpoint exists.

---

## 7. Special Query Params Probed

| Param               | Result |
|---------------------|--------|
| `format=ndjson`     | Ignored — returns normal JSON |
| `stream=true`       | Ignored — returns normal JSON |
| `parallel=true`     | Ignored — returns normal JSON |
| `offset=0`          | Ignored — cursor-only pagination |
| `page=1`            | Ignored — cursor-only pagination |
| `sessionId=<uuid>`  | **WORKS** — filters events by session |

### `?sessionId=<uuid>` filter (key finding)

```bash
GET /api/v1/events?sessionId=8a999d37-7532-4a32-80c5-d303a8b9c356&limit=100
```

Returns only the events for that session. The session with `eventCount: 47` returned exactly 47 events in one page. This enables **parallel ingestion by session**.

---

## 8. HTTP Methods

| Method  | `/events` | Notes |
|---------|-----------|-------|
| GET     | 200 OK    | Works normally |
| HEAD    | 429 or 200| Counts against rate limit |
| OPTIONS | 504 Gateway Timeout | Not supported |
| POST    | Not tested | |

---

## 9. Dashboard

- Root at `http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com` — React SPA (nginx/1.29.4)
- No API discovery from dashboard UI (single-page app with bundled JS)
- API is behind AWS ALB (`Server: awselb/2.0` on errors)

---

## 10. Timestamp Format Inconsistency

Events use **two different timestamp formats** (both in same page):

```json
{"timestamp": 1769541612369}             // Unix ms (number)
{"timestamp": "2026-01-27T19:19:13.629Z"} // ISO 8601 string
```

Both must be normalized when storing to PostgreSQL. Recommended: always convert to `TIMESTAMPTZ`.

---

## 11. Throughput Math

### Strategy A: Sequential cursor pagination on /events (10 req/60s, limit=5000)

- 3,000,000 ÷ 5,000 = **600 pages** minimum
- At 10 req/60s = **60 minutes** for 600 requests
- Throughput: **50,000 events/minute**

### Strategy B: Parallel session-based ingestion (recommended)

- 60,000 sessions × ~50 events average = 3,000,000 events
- Fetch all sessions: 60,000 ÷ 5,000 = **12 pages** at 40 req/60s → ~18 seconds
- Fetch events per session with `?sessionId=<uuid>&limit=5000`: most sessions fit in 1 page
- `/events` rate limit = 10 req/60s → can only do 10 session-filtered requests/minute
- Net throughput per minute: 10 × ~50 events = 500 events/minute (WORSE — same rate limit applies)

**Conclusion:** The `?sessionId` filter is useful for **parallelizing across multiple API keys** if available. With a single key, the /events rate limit (10 req/60s) is the binding constraint regardless of strategy.

### Optimal single-key strategy

Use **`limit=5000`** (maximum effective) with cursor-based sequential pagination on `/events`:
- 600 requests total
- At 10/60s = 60 minutes — just within the 90-minute key TTL
- Use cursor refresh before `cursorExpiresIn` (116s) window
- Refresh cursor when `cursorExpiresIn < CURSOR_REFRESH_THRESHOLD` (recommend: 30s)

### Throughput optimization

- Use `WORKER_CONCURRENCY` to pipeline: fetch next page while inserting current page
- Batch INSERT into PostgreSQL (use `INSERT ... ON CONFLICT DO NOTHING` for idempotency)
- Store checkpoint (last cursor) in PostgreSQL after each successful page
- On restart, resume from saved cursor (but verify it hasn't expired — if so, restart from beginning or use last ingested event's timestamp/id to binary search)

---

## 12. Recommended Ingestion Architecture

```
1. Check PostgreSQL for saved cursor checkpoint
2. If cursor exists and not expired → resume from cursor
3. If no cursor (or expired) → start from beginning
4. Worker loop:
   a. GET /events?limit=5000[&cursor=...]
   b. Parse response, normalize timestamps
   c. Batch INSERT into PostgreSQL (upsert by event ID)
   d. Save nextCursor to checkpoint table with expiry
   e. If cursorExpiresIn < 30s → log warning, cursor may expire before next page
   f. On 429 → wait X-RateLimit-Reset seconds, retry
   g. On 502 (stale cursor) → log error, attempt restart
   h. When hasMore=false → log "ingestion complete"
5. Rate limit: ~6s between requests to stay under 10/60s
```

### Key implementation notes

- **Single worker** is optimal for a single API key (rate limit = 10/60s)
- **Idempotent inserts** handle restarts cleanly
- **Checkpoint table** must store cursor string + expiry timestamp
- **Timestamp normalization**: check `typeof timestamp === 'number'` → treat as Unix ms; string → parse as ISO 8601
- **"ingestion complete"** log message is required for `run-ingestion.sh` to pass

---

## 13. Surprises & Undocumented Features

1. **`/sessions` endpoint** — not in docs, 4x higher rate limit (40/60s), contains `eventCount` per session
2. **`/metrics` endpoint** — not in docs, currently empty
3. **`?sessionId=` filter on /events** — not documented, enables per-session event fetching
4. **`meta.total: 3,000,000`** — confirmed total count in every response body
5. **`cursorExpiresIn` field** — in pagination object, gives seconds until cursor expires (use this for refresh logic)
6. **Cursor is base64-encoded JSON** — decodable, contains `exp` field as absolute Unix ms timestamp
7. **Bad cursor returns 502** — not 400 or 422; must handle as a special case
8. **`X-Cache: HIT/MISS` with 30s TTL** — identical requests within 30s are cached; changing `limit` or `cursor` bypasses cache
9. **Limit cap at 5,000** — `limit=10000` returns same result as `limit=5000`
10. **OPTIONS times out** — not supported; HEAD counts against rate limit
