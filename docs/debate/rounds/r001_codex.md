# Codex R1 — Technical Implementation

Decision 1: **(c) HTTP + SSE.** `stdio` MCP is the wrong transport for a long-lived observation firehose. It is good for request/response tools, bad for adapter lifecycle, reconnects, buffering, and multi-producer flow control. Unix sockets are fine until you need cross-machine, then you invent a second transport later and fork the protocol. HTTP gives you one contract for local and remote; SSE is enough for server->adapter push like subscription updates, lease notices, and backpressure signals. Heavy is acceptable. Replacing a bespoke transport later is not.

Decision 2: **(b) web URL + claude-code.** Local markdown proves nothing important. The hard engineering is freshness, canonicalization, diffing, TTL, partial fetch failure, and crawl provenance. `claude-code` still validates passive ingest, while URLs force you to confront content hashing, ETag/Last-Modified lies, boilerplate stripping, and source churn immediately. That is where this system will actually fail.

Decision 3: **(b) Python.** Single runtime wins maintainability. The hard parts are crawling, extraction, normalization, scheduling, and deterministic transforms over messy text, not MCP glue. Python has the best libraries and the least friction around SQLite, parsers, and future extraction needs. Hybrid is the worst option: two dependency graphs, two release processes, and undefined ownership at the core boundary. Node/Bun is attractive only if you optimize for adapter convenience over system longevity.

Stress test 2: **the provenance ledger rebuild story is currently fiction.** SQLite can be an excellent append-only ledger, but only for immutable observations. It is not enough to say “L0 is ground truth” if L2 facts and L3 wiki are produced by model calls, HTML cleaners, chunkers, and extractors whose behavior changes over time. Rebuild only works if every ledger row stores raw bytes or a content-addressed blob pointer, source metadata, transform version, model ID, prompt version, parser version, and normalization policy. Otherwise `kb relearn` will not reproduce prior state; it will produce drift. Also, SQLite in WAL mode still has a single writer. If rebuild replays millions of observations while live ingest is running, you will serialize on one writer and create tail latency unless rebuild is offline or checkpointed in batches.

Protocol critique: **one write pipeline for all three ingest paths will break.** Active push, passive sniff, and crawl do not have the same latency budget, trust model, or idempotency semantics. If they all synchronously do “ledger write -> chunk -> embed -> BM25 -> fact extraction -> wiki update,” crawl bursts will starve interactive ingest, and any failure between SQLite and LanceDB leaves split-brain state because there is no cross-store transaction. SQLite can atomically commit its own tables; it cannot atomically commit with LanceDB. So `kb.observe` must land only an immutable observation plus dedupe key, then enqueue downstream derivations.

Concrete schema should look like:

```json
{
  "observe_id":"uuid",
  "source_kind":"adapter|push|crawl",
  "source_uri":"logical-or-remote-uri",
  "session_id":"optional",
  "occurred_at":"RFC3339",
  "captured_at":"RFC3339",
  "content_hash":"sha256",
  "mime_type":"text/markdown",
  "bytes_ref":"blob-pointer-or-inline",
  "adapter":"claude-code@version",
  "sequence":"monotonic-per-source",
  "trust_tier":"user|first_party|web",
  "redactions":[...],
  "idempotency_key":"stable-key",
  "transform_policy":"policy-version"
}
```

What is missing: ack/retry semantics, ordering guarantees, max payload rules, chunking contract, redaction boundaries, tombstones for source deletion, and capability/version negotiation between adapters and core. MCP reality: notifications are not a durability protocol. You still need your own delivery and replay contract.

The biggest blind spot: **you are deluding yourself that “complete” is a guarantee.** Passive capture plus subscribed crawl can improve coverage; they cannot prove completeness. Treat completeness as a measurable SLO per source domain, not as a system invariant. If you build around a fake guarantee, L4 becomes an infinite complexity sink.
