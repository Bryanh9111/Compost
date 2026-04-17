Pick: E — stream-puller + ingest-adapter, mock MCP client

---

### Three concrete technical reasons

**1. outbox CHECK(source_kind) blocks F without a migration.**
`packages/compost-core/src/schema/0005_merged_outbox.sql:14` enforces `source_kind IN ('local-file','local-dir','web','claude-code','host-adapter','sensory')`. Injecting Engram entries as outbox rows requires either adding `'engram'` to that CHECK (a new migration, touching the canonical drain contract) or abusing an existing kind like `'host-adapter'` (a silent lie that poisons source attribution in every downstream query). Neither is free. E avoids touching this boundary entirely.

**2. `startIngestWorker` in `compost-daemon/src/scheduler.ts:257` is a Python subprocess pipeline — Engram event payloads are structured JSON, not raw bytes for extraction.**
The ingest worker at `scheduler.ts:295-322` pipes `raw_bytes.toString("utf-8")` through `compost_ingest extract`. Engram entries are pre-structured (subject/predicate/object equivalent already resolved by Engram's `remember()`). Forcing them through Python extraction adds a spurious NLP hop that will hallucinate additional facts or flatten the existing structure. E's direct ingest-adapter maps Engram fields to `facts` + `chunks` rows natively, skipping the extractor correctly.

**3. S4 mock pattern is already established and closes anchor v2.**
`packages/compost-engram-adapter/src/writer.ts:47-54` defines `EngramMcpClient` as an interface — concrete impl was intentionally deferred. E follows the same discipline: stream-puller polls `stream_for_compost`, a mock `EngramStreamClient` interface covers tests, and concrete MCP transport lands in S6 inside the daemon layer (correct boundary). This gives a functional in-and-out loop (anchor v2 satisfied: both directions are code-complete behind the interface, not just one), while keeping the adapter package free of daemon-layer MCP subprocess coupling.

---

### Two main risks of E

**1. Mock drift at S6 handoff.** If the `EngramStreamClient` mock interface drifts from the real `stream_for_compost` tool schema (field names, pagination envelope, `since` cursor type), S6's concrete impl will silently fail at runtime — not at test time. The 2am scenario: stream returns 0 rows forever because `since` expects an ISO string but mock used a unix int, and no integration test caught it.

**2. Ingest-adapter must produce a valid `observations` row that satisfies `startIngestWorker`'s `SELECT observe_id, source_uri, mime_type, raw_bytes`.**
If ingest-adapter skips `raw_bytes` (Engram entries have no raw bytes) or sets a `source_uri` that doesn't resolve in the `source` table, `claimOne` will claim the row and `processOne` will log "observation not found" and silently fail every Engram-origin item. The 2am scenario: all facts land in `ingest_queue` but none ever reach `facts` table; `compost facts list` returns zero Engram-origin results with no visible error.

---

### One-line stances

- **B/C anchor v2 violation?** Yes, obvious no-go — half-shipped by definition; Phase 6 Curiosity has no event stream to subscribe to.
- **F (outbox) vs E (new ingest)?** E wins: `0005_merged_outbox.sql:14` CHECK blocks F without a migration that touches the drain contract, and Engram's structured payloads are wrong input for the Python extractor.
- **EngramMcpClient: adapter vs daemon boundary?** Interface in adapter (`writer.ts:47`), concrete MCP transport impl in daemon — same discipline as S4's `EngramWriter`.
- **Phase 6 Curiosity: unlock in S5 or wait?** Physically unlock the data path in S5 (stream pulls land in facts), logically defer Curiosity scheduling policy to S6.
- **280-400 LoC single-session discipline?** E lands at ~300 LoC: stream-puller loop + cursor persist + ingest-adapter mapping + mock client + tests. Fits. Do not gold-plate reconcile.
- **Reconcile tool in S5 or S6?** S6. S5 cursor is monotonic append-only; reconcile needs a full-scan diff that requires both directions stable first.

---

### If you pick something else

Pick F and you spend the session writing migration 0016 to loosen a CHECK that exists for a reason, then discover Engram JSON goes in as `raw_bytes` and comes out as re-extracted nonsense facts at 2am when the Python extractor invents structure that was already correct.
