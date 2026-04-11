### 1. Shippability verdict

**HOLD** — coding is premature because the spec does not define a complete durable write protocol for the outbox-to-`observations` handoff. The concept is sound, but at least 3 fixes are required first:
1. Make the canonical outbox schema and drain/ack transaction explicit, including crash points and exactly-once rules.
2. Reconcile the `ObserveEvent` contract with `observations.adapter` and `observations.adapter_sequence`.
3. Fix `compost reflect` so sensory hard-GC cannot violate existing foreign keys or silently destroy rebuild provenance.

### 2. Top 3 concerns

1. **§3.2-§3.3 / §3b.2 / §11 (`lines 511-523`, `543-551`, `1054-1056`)**. Failure mode: the spec promises durable append-before-ack and "exactly once" after daemon restart, but it never defines the `observe_outbox` schema, the ack marker, the daemon drain transaction, or the ordering of `observations` insert vs `ingest_queue` enqueue vs outbox ack. That is where crashes happen. Today two implementations could both claim spec compliance and still differ on whether a daemon crash after `observations` insert but before outbox ack duplicates or loses work. Concrete fix: inline the outbox table DDL in this spec, add a unique key on `(adapter, source_id, idempotency_key)`, and specify one canonical transaction: claim outbox row -> `INSERT OR IGNORE` into `observations` -> enqueue `ingest_queue` -> mark outbox row acked.

2. **§1.1 / §3.1 / §5 (`lines 150-167`, `460-471`, `687-698`)**. Failure mode: `observations` requires `adapter TEXT NOT NULL` and `adapter_sequence INTEGER NOT NULL`, but both `ObserveEvent` interfaces omit `adapter`, and the hook path in §3b defines no source for `adapter_sequence`. The first implementer will have to invent hidden fields not present in the public contract. Concrete fix: add `adapter` to both `ObserveEvent` definitions, and define hook sequencing explicitly, for example a per-adapter `observe_outbox.seq INTEGER PRIMARY KEY AUTOINCREMENT` that is copied into `observations.adapter_sequence` during drain.

3. **§8.4 vs §1.1/§1.2 (`lines 910-913` vs `197-202`, `214-215`, `309-313`)**. Failure mode: `reflect()` hard-deletes from `observations`, but `captured_item.observe_id`, `facts.observe_id`, and `wiki_page_observe.observe_id` all reference `observations` without `ON DELETE CASCADE`. Once a sensory observation has downstream facts or coverage rows, the DELETE will fail under `PRAGMA foreign_keys = ON`. Concrete fix: either state that `source.kind='sensory'` rows are never derivation inputs and enforce that at queue admission, or change the GC model to soft-delete observations / cascade-delete all dependent rows intentionally.

### 3. Internal inconsistencies

- **§3.2 (`line 513`)** says the outbox is "Same as phase0-spec.md §3", but §11 says this file is the canonical spec. The canonical write-path schema cannot live in a superseded document.
- **§3b.2 (`line 543`)** depends on `reference-survey-claude-code-source.md`, which is not defined in this spec. If that payload shape matters, the minimum JSON contract belongs here.
- **§5 (`lines 706-725`, `757-790`)** exposes `QueryOptions.contexts` and `QueryHit.contexts`, but the SQL does not join `fact_context`, and `facts` has no `contexts` column to populate `r.contexts`.
- **§10 (`lines 1014`, `1019`, `1026`)** references `compost crawl` and `compost relearn`, but §0 (`lines 112-121`) defines neither CLI command.
- **§2 (`line 446`)** says `derivation_run.transform_policy` is a "foreign-key-to-data column", but §1.2 (`lines 239-256`) does not declare an FK to `policies(policy_id)`.

### 4. Missing pieces

- The ingest worker lease protocol is incomplete: schema exists for `lease_owner`, `lease_token`, `lease_expires_at`, but there is no claim SQL, renewal rule, retry backoff, or stale-lease recovery contract.
- Security is missing. The spec stores `raw_bytes` and hook envelopes under `~/.compost/`, but says nothing about file permissions, multi-user machines, or whether MCP clients can read all provenance by default.
- Test coverage for crash semantics is underspecified. You have one restart test in §11, but not the matrix of crash points around outbox append, daemon drain, queue enqueue, and reflect GC.

### 5. Personal sign-off

I would not approve coding today. The data model is close, but the parts most likely to bite you first are exactly the parts still hand-wavy: durable handoff boundaries, sequence/idempotency semantics, and deletion under foreign keys. Those are not polish issues; they determine whether Phase 0 can survive retries and restarts without data loss or duplicate ingest. Once the write protocol and GC rules are made executable in the spec, the rest looks implementable.
