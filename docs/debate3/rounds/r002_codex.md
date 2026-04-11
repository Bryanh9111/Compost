Gemini and Sonnet are right that context must become a first-class entity, but Opus overstates the “all additive” framing unless migration order is explicit. `derivation_run` has precedence over `context`/`fact_context`/`context_scopes`, because Phase 0 first needs a correct replay identity before it can safely add context-sensitive freshness or inheritance. If you ship Sonnet’s `fact_context.freshness` while `derivations` still collapse policy-only reruns under `(observe_id, layer, model_id)`, the system can mark a fact stale in one context but still be unable to prove which derivation produced the current artifact. So the order is: replace `derivations` with `derivation_run`; normalize `wiki_page_observe`; then add a merged Sonnet+Gemini context table (`context_scope` with `parent_id`, `isolation_level`, and per-context freshness/trust settings). Compatible, yes; commutative, no.

On Opus’s Risk A: yes, he is right, and this is now a ship blocker. Phase 0’s whole contract is “L0 is anchor, L1-L3 are rebuildable views,” but the checklist only verifies counts. The concrete test is not just “rerun ingest.” It should: seed 3 deterministic observations; run extraction under a fixed `transform_policy`; snapshot ordered `(observe_id, chunk_id, chunk_hash, token_count)` for L1; delete the LanceDB rows and mark the corresponding `derivation_run` rows `superseded`; invoke `compost doctor --rebuild L1 --policy tp-2026-04`; then assert the rebuilt rows match the snapshot exactly. If chunk hashes drift under unchanged policy, the rebuild story is false. I would also add one negative test: rerun with `tp-2026-05` and assert both old and new `derivation_run` rows coexist, with only one active.

Opus’s Risk B on the Python extractor is also directionally correct, but the hidden protocol bug is not just “missing context parameter.” If extraction varies by context, then `(adapter, source_id, idempotency_key)` cannot stay context-blind unless idempotency is redefined as “L0 observation identity only.” That is the right boundary. The observation row should remain deduped on source event identity, not extraction profile. Context-sensitive behavior belongs in derivation inputs, not observation keys, otherwise the same Slack message captured in `work` and `personal` becomes two L0 rows and portability gets worse. So: keep `observations.idempotency_key` unchanged, add `context_scope_id` and optional `extraction_profile` to `derivation_run`, and pass them to Python during derivation. Different contexts should yield different L1/L2 runs from the same L0 anchor, not different anchors.

I’ll also push back on my own R1 write-topology critique: a queue lease token is enough for Phase 0 if we define it precisely and stop pretending `AsyncMutex` is the whole protocol. The queue needs cross-process, cross-machine ownership:

```sql
ALTER TABLE ingest_queue ADD COLUMN lease_owner TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_token TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_expires_at TEXT;
CREATE INDEX idx_queue_claim
ON ingest_queue(priority, enqueued_at, lease_expires_at)
WHERE completed_at IS NULL;
CREATE UNIQUE INDEX idx_queue_active_lease
ON ingest_queue(lease_token)
WHERE completed_at IS NULL AND lease_token IS NOT NULL;
```

`lease_owner` should be a stable replica identifier plus process identity, e.g. `laptop-7f3c:daemon:pid1234` or `desktop-a91e:cli:pid88`; `lease_token` is a UUID per claim attempt; `lease_expires_at` is short TTL, renewed heartbeat-style. Claim SQL must be `UPDATE ... WHERE completed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at < now)` and then verify `changes()=1`. On crash, another worker steals only after expiry. This does not solve sync, but it does make “one active processor per queue item” real.

Revised scores: Axis 1 stays 1, but Axis 6 drops from 1 to 0 because Opus is correct that rebuild verification is missing from the Phase 0 definition of done. Without that test, the dependency graph claims a property the implementation never proves.
