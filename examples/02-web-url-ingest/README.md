# 02 — Web URL ingest

`compost add <url>` fetches a page, runs the same extraction pipeline as
a local file, and records ETag / Last-Modified headers so future
freshness checks can short-circuit with HTTP 304.

## What you will see

1. First `add` fetches the page and writes an observation.
2. Second `add` on the same URL, shortly after, receives 304 Not Modified
   and skips extraction entirely.
3. The `source` table records the URL as a first-class source.
4. The `web_fetch_state` table tracks ETag / Last-Modified headers per URL.

## Run it

Pick any stable public page. The one below is a well-known example; swap
it for anything you want to remember.

```bash
# First fetch — full pipeline runs
compost add https://en.wikipedia.org/wiki/Knowledge_graph

# Same URL again — should skip via HTTP 304
compost add https://en.wikipedia.org/wiki/Knowledge_graph

# Query against the freshly ingested content
compost query "knowledge graph"
```

## Inspect fetch state

```bash
sqlite3 ~/.compost/ledger.db \
  "SELECT source_id, etag, last_modified, last_status_code, consecutive_failures
   FROM web_fetch_state
   ORDER BY last_fetched_at_unix_sec DESC LIMIT 5"
```

A fresh fetch shows `last_status_code=200` and populated ETag/Last-Modified.
A 304-short-circuited re-fetch keeps the same ETag and increments
`last_fetched_at` only.

## Provenance (Migration 0014)

Web-fetched observations record:

- `adapter = 'web-url'`
- `method = 'web-url'`
- `origin_hash = SHA-256('web-url|<url>|<idempotency_key>')`

Content-conditional fetches are idempotent by the same `idempotency_key`
computation (`SHA-256('web:<url>:<content>')`), so the same unchanged page
does not double-count.

## Networking

This example needs outbound HTTPS. There is no mock — by design. If you
are offline, use example 01 instead.
