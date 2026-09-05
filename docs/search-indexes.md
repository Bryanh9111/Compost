# Search indexes

Engram and Compost retain independent SQLite stores. Compost's actions and
artifact pointers are indexed across all history; `cover` and `route` select
matching records before limiting candidates. A topic query considers up to 200
ranked lexical candidates, then applies the existing coverage scoring. Time and
project filters apply before candidate truncation. Timeline queries use indexes
on `julianday(when_ts)` and the existing `created_at` tie breaker.

Keyword search keeps FTS5's unicode61 tokenizer. A second FTS5 projection stores
overlapping Han bigrams as UTF-8 hex tokens. A quoted phrase over these tokens
matches a continuous substring, including two-character queries such as `检索`.
Non-Han boundaries separate phrases; disconnected pairs do not constitute a
match. JSON artifact values are decoded before Chinese indexing. This is
literal substring retrieval, not Chinese word segmentation, synonym expansion,
Japanese/Korean analysis or semantic understanding. Single-Han queries do not
use this supplemental index.

SQLite triggers update the projections in the source transaction, including
writes from other SQLite clients. Indexes require no application-registered
functions. Existing rows are backfilled by migration 0027. The indexed content
is derived; ownership, action IDs, source records and artifact locations do not
change. Archived facts are filtered against the current base table before
returning results, including candidates from the optional vector path.

```bash
compost indexes                  # verify both lexical paths and report state
compost indexes --rebuild        # atomic rebuild from source records
bun bench/search-index.bench.ts  # disposable lexical quality evaluation
```

The diagnostic checks actual FTS postings, missing/changed Chinese projections,
and orphans. Failure returns a nonzero exit code. `version` identifies the
analyzer schema; `source_revision` and `indexed_revision` count indexed text
mutations since backfill and advance together in the transaction. These local
revision counters are not upstream Engram stream cursors. `indexed_at` records
the last indexed text mutation and `rebuilt_at` the last full rebuild. Status or
access-count changes do not require Chinese retokenization; query-time base-table
filters enforce lifecycle state. Diagnostics use a consistent transaction and
SQLite's FTS integrity commands; they can briefly contend with writers.

Rebuild verifies before commit and rolls back on failure. Normal readers see
the previous committed indexes until the transaction completes. The diagnostic
and rebuild concern lexical indexes; vector manifests, embedding backlog and
LanceDB repair continue through the existing doctor/rebuild flow. Neither
command creates background reasoning, wiki pages or durable synthesized claims.

Optional semantic retrieval defaults to a 1,500 ms budget, including waiting for
the shared Ollama lock and generating the query embedding. Set
`COMPOST_SEMANTIC_TIMEOUT_MS=0` for lexical-only retrieval, or a positive value
(up to 60,000 ms) for a different budget. Core callers can set
`QueryOptions.semantic_timeout_ms`. On timeout or error, lexical results remain
available. Cancellation reaches Ollama lock waits and HTTP requests; a LanceDB
native search already in progress may finish internally, but its late result
is discarded. This budget applies to retrieval, not subsequent `ask` synthesis.

The hand-authored quality fixture includes English, paths, punctuation, two-Han
queries, longer substrings, supplementary Han characters, metadata, negatives
and project filtering. It checks Recall@10 and MRR on that fixture only; it is
not a production semantic-quality estimate. Capacity decisions still require
representative production workloads and measured concurrency/latency.

Before first activation on an existing installation, take a verified backup,
apply through the supported CLI, and restart the daemon. Long-lived MCP clients
must reconnect to load changed code. Rollback must account for the newer SQL
schema: prefer fixing or rebuilding derived indexes rather than overwriting
new user records with an old database snapshot.
