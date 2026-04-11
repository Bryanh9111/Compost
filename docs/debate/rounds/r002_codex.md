# Codex R2 — Cross-Critique

I concede D1 for v0. Plain stdio MCP is good enough for 1-3 machines if `kb.observe` is modeled as notification plus adapter-local spool. The failure mode I was pointing at is still real: MCP notifications have no delivery ack, replay cursor, or congestion contract. If `kb-core` restarts after the adapter writes to stdout but before the observation is durably committed, that event is gone. If the core stalls, the stdio pipe backpressures and the adapter blocks its host process. Those are not hypothetical. But they are solved cheaper in month one with an adapter-local SQLite spool (`observe_outbox(seq INTEGER PRIMARY KEY, payload JSON, sent_at, acked_at)`) and replay on reconnect than with HTTP+SSE plus auth and service management. D1 shifts: `stdio` MCP now, transport-neutral schema, HTTP later when cross-machine is real.

I concede D3 to hybrid with a hard boundary. My “two dependency graphs is the worst option” argument does not survive a strict subprocess contract. If Node owns Core/MCP/adapters and Python owns extraction only, that is operationally sane. Treat Python exactly like `ffmpeg`: version-pinned CLI, JSON in/out, no shared mutable state, no DB writes. The contract is `extract --mime text/html --uri ... -> {content, blocks[], metadata, extractor_version, warnings[]}`. Node persists the raw blob, extracted blocks, and version stamps. That keeps LanceDB and MCP in one runtime and uses Python where the ecosystem is materially better.

Opus’s “interesting-ness” critique is correct, and the implementation is straightforward. Re-crawl is a three-stage gate:
1. Normalize content, then hash it: `raw_sha256`, `norm_sha256`.
2. Compute 5-shingle MinHash over normalized text; skip if estimated Jaccard with the latest snapshot is `>= 0.98`.
3. For changed pages, chunk and embed; skip chunks whose cosine similarity to prior chunks is `>= 0.985` unless they introduce a new `(entity, relation, value)` triple, named entity, date, or number.

A page is noteworthy iff `new_claims > 0 OR changed_claims > 0 OR novel_chunk_ratio >= 0.05`. Near-duplicate snapshots are tombstoned instead of indexed. That gives L4 a real decision rule: shingling for structural change, MinHash for fast set comparison, embedding thresholds for semantic dedup, and triple-delta for factual novelty.

“Complete” remains an SLO, not a guarantee, and now it has schema. Only enumerable subscriptions get a coverage SLO: feeds, sitemaps, repo commits, chat logs.

```sql
CREATE TABLE source (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  refresh_sec INTEGER NOT NULL,
  coverage_target REAL NOT NULL
);
CREATE TABLE expected_item (
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  expected_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);
CREATE TABLE captured_item (
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id, captured_at)
);
```

```sql
SELECT s.id,
       1.0 * count(DISTINCT c.external_id) / nullif(count(e.external_id),0) AS coverage_ratio,
       max(c.captured_at) AS last_capture
FROM source s
LEFT JOIN expected_item e ON e.source_id=s.id AND e.expected_at>=datetime('now','-24 hours')
LEFT JOIN captured_item c ON c.source_id=e.source_id AND c.external_id=e.external_id
  AND c.captured_at>=datetime('now','-24 hours')
GROUP BY s.id;
```

Alert if `coverage_ratio < coverage_target` for two consecutive windows, or `now - last_capture > 2 * refresh_sec`. That is the only honest implementation of “complete.”

D2 shifts as well. Sonnet was right on sequencing, Opus was right on urgency. Week 1: local markdown plus `claude-code` to harden `kb.observe`, dedup, and replay. Week 2: web URL plus `claude-code` to force TTL, canonicalization, and freshness. If forced to pick one literal first deliverable, it is now (a), with (b) immediately after.

Update on the decisions:
- D1 shifted from HTTP+SSE to stdio MCP notifications plus adapter outbox.
- D2 shifted from exclusive web-first to local-first, web-immediately-after.
- D3 shifted from pure Python to hybrid with a subprocess extraction boundary.
