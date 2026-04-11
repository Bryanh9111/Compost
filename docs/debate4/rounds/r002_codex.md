## Confirmations

Sonnet was right that A+B only compose cleanly under two-stage retrieval if the expensive joins happen after ANN narrows the candidate set. That strengthens my R1 position, not weakens it: stateless decay is fine, but only with bounded rerank work and a request-scoped `as_of_unix_sec`.

Gemini's "Storage Class Collision" on C is the same physical failure I called "shared page churn": mixing hot-delete sensory/blob-heavy rows with long-lived semantic/procedural rows destroys locality and makes "semantic only" queries pay unrelated I/O. That is real evidence for vertical partitioning.

Opus also fixed a real gap in my D critique: if `compost hook` is only the Claude-Code adapter entrypoint and still writes to the same outbox with deterministic `idempotency_key = sha256(adapter || source_id || envelope)`, my original "protocol replacement" objection mostly falls away.

## Attacks

Gemini's original C score of 3/3 was still too generous because the literal proposal was "ONE physical table." If we mean a single sparse table with `kind`, wide nullable columns, and blobs nearby, I still reject it.

Opus's D mitigation via `async:true` immediate return is only half-right. It is a latency mitigation, not a correctness mitigation. If the hook returns success before the durable outbox append, the system has acknowledged an event that may still be lost. The safe split is: synchronous local append, asynchronous downstream enrichment/reconciliation. If Node cold start prevents even that from fitting budget, use a thinner wrapper binary; do not move durability behind the async boundary.

On B, Sonnet's batch-async `access_log` idea is directionally correct, but only if "async" means outside the query transaction and preferably after the response is formed. A synchronous append on every `compost.query` call is still a hot-path write and will show up under WAL contention. The right model is retrieval-feedback as telemetry: append-only, fire-and-forget, and replay-safe.

## Opus Meta-Observation Check

On C: yes. I want the same converged physical shape Opus attributes to Gemini: shared logical surface, vertical partitioning, kind-specific extension tables, and partial indexes on hot paths. The real disagreement was with the literal "one physical table" wording. Under the corrected framing, C moves from 1/3 to 2/3.

On D: yes, the deterministic idempotency key fixes my specific idempotency-drift concern. Under corrected framing, D moves from 1/3 to 2/3, not higher. Reason: the remaining risks are operational, not conceptual: cold-start overhead, host-specific semantics, and making sure durability happens before acknowledgment.

## New Risk Or Refinement

The strongest new refinement from R1 is Sonnet's query/ask formula skew. If `compost.query` reranks live candidates with A+B but `compost.ask` answers from prebuilt wiki pages, users will see contradictory recall surfaces. The fix is simple: `compost.ask` must either call the same retrieval pipeline or at minimum carry the same `ranking_profile_id` and `as_of_unix_sec` through page selection. One ranking contract, multiple call sites.

## Revised Scores

| Decision | R1 score | R2 score | Reason for change |
|---|---:|---:|---|
| A | 2/3 | 2/3 | Still right with required `as_of` and explicit reinforcement timestamp; active forgetting is adjacent but separate |
| B | 2/3 | 2/3 | Staged adoption still correct; bounded factors, auditability, and latency budget remain mandatory |
| C | 1/3 | 2/3 | Opus/Gemini reframing resolves the strawman if physical storage is actually partitioned |
| D | 1/3 | 2/3 | Deterministic idempotency on same outbox fixes the core replay objection; durability/latency concerns remain |

## Composition Check Update

A+B now compose if retrieval feedback is not written inline. Batch-async access logs are the right architecture only when they are off the critical read path. Reinforcement can lag by one batch without harming correctness. That keeps A stateless at ranking time while still feeding B.

Opus's B time budget is reasonable: p50 under 100ms is achievable if rerank is capped to a small post-ANN candidate set, terms are bounded/`COALESCE`d, and kind-specific joins stay indexed. If the formula cannot hit that budget, the answer is to drop factors, not to accept slower recall.

Opus's active-forgetting gap belongs next to A, but it is not part of A itself. Decay is ranking semantics; hard-GC is storage lifecycle policy. Sensory-tier TTL/GC should be specified in the same release because otherwise "stateless decay" becomes an excuse to postpone actual forgetting forever.
