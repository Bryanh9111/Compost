## Final scores

| Decision | Final | Change |
|---|---:|---|
| A | 2/3 | 2 -> 2 -> 2 |
| B | 2/3 | 2 -> 2 -> 2 |
| C | 3/3 | 1 -> 2 -> 3 once the extractor default is closed correctly |
| D | 3/3 | 1 -> 2 -> 3 only if ack follows durable append; async-true is not acceptable |

## Q1 resolution

Dual-emit. Single-emit-with-promotion makes extractor classification a correctness boundary: one misclassified event disappears from semantic recall unless every caller remembers to bridge tables perfectly. That is the wrong failure mode. Emit semantic always; emit episodic additionally when explicit time plus participants are present; share `observe_id` and derivation lineage; let the unified query surface dedupe by `observe_id` unless the caller requests raw records. This preserves semantic search, keeps timeline/event queries possible, and avoids making a lossy ontology choice at ingest time.

## Q2 resolution

Synchronous outbox append is mandatory. Returning success before the SQLite WAL commit moves durability behind the ack boundary and turns event loss into a normal crash mode. The safe split is: sync local append, async downstream enrichment/replay. If Node cold start cannot meet budget, the right mitigation is a tiny native append-only helper (`compost-hook`, Go or Rust is fine) whose only job is parse stdin, compute deterministic `idempotency_key`, append to the same `outbox.db`, fsync/WAL commit, exit. A thinner Node entry is a tuning attempt, not the architectural answer.

## Spec requirements

A: The spec must say every ranked read binds one request-scoped `as_of_unix_sec`, and `compost.query`/`compost.ask` perform no inline reinforcement writes.

B: The spec must set a rerank SLO (`p50 < 100ms`, `p99 < 500ms` on 100k facts) and require factors to stay disabled if they miss budget.

C: The spec must define dual-emit semantics, shared `observe_id`, and dedupe rules in the UNION query surface so one observation does not appear twice by default.

D: The spec must state hook success is returned only after durable local append to the shared outbox, with deterministic `idempotency_key = sha256(adapter || source_id || envelope)`.

## Tie-break statement

I will concede on Q1 only to a compromise that guarantees episodic observations remain retrievable through the semantic query path without reclassification at query time. I do not concede on Q2: durability must stay on the pre-ack side of the boundary.
