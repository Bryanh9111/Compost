1. **Top 3 architectural risks**

- **Risk 1: the write topology is not actually single-writer.** The spec mixes three write paths: adapter-spawned daemon via `AdapterConfig.coreCommand` (`docs/phase0-spec.md:292-307`), direct embedded writes via `createCompost()` (`docs/phase0-spec.md:530-547`), and CLI `compost add` explicitly bypassing MCP in Step 17 (`docs/phase0-checklist.md:131-139`). The only concurrency guard is the LanceDB `AsyncMutex` + file lock (`docs/phase0-checklist.md:99-103`, `docs/phase0-spec.md:701-702`), but `ingest_queue` has no lease token or owner column (`docs/phase0-spec.md:141-154`). Real failure: Claude Code, `compost add`, and a second host agent all target the same `~/.compost`; two workers claim the same queue row and derive competing L1/L2 artifacts.

- **Risk 2: replay/migration semantics break on policy-only changes.** `derivations` is keyed by `(observe_id, layer, model_id)` and stores `transform_policy` as payload only (`docs/phase0-spec.md:127-138`). Debate #2 assumes rebuild scope is encoded by `(layer, model_id)`, but §2 explicitly allows policy revisions that change chunking or prompts without changing model id (`docs/phase0-spec.md:223-268`). Real failure: `tp-2026-04-02` changes chunk overlap only. The old L1 row already occupies `(observe_id,'L1','nomic-embed-text-v1.5')`, so the new derivation cannot be represented, and Step 18 still reports the observation as covered (`docs/phase0-checklist.md:136-138`).

- **Risk 3: contexts and cross-machine identity are under-modeled.** `source.contexts`, `facts.contexts`, and `wiki_pages.contexts` are JSON arrays (`docs/phase0-spec.md:89-99`, `175-200`), and query only accepts `contexts?: string[]` (`docs/phase0-spec.md:511-515`). That cannot encode per-context freshness, trust, privacy, or partial sharing. Observation identity is also local: `(adapter, source_id, idempotency_key)` plus `adapter_sequence` per adapter/source (`docs/phase0-spec.md:103-120`), while outbox ack is just “return the idempotency_key” (`docs/phase0-spec.md:400`). Real failure: laptop and desktop both ingest the same repo, or two adapters emit conflicting facts for different contexts. There is no replica id, merge protocol, or scoped contradiction model.

2. **Concrete schema change**

```sql
CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT
);
CREATE UNIQUE INDEX idx_derivation_run_active
ON derivation_run(observe_id, layer, transform_policy, model_id)
WHERE status IN ('pending','running','succeeded');
```

This fixes the live-migration hole: policy changes become first-class runs, doctor can compare against the latest `status='succeeded'` row, and replay can supersede old artifacts instead of overwriting history.

3. **Axis scores**

- **1. Brain-like self-evolution: 1/3.** Raw observations are a good anchor, but the derivation lifecycle cannot safely re-derive under evolving policy.
- **2. External knowledge absorption: 2/3.** The adapter/Python boundary is extensible, but source identity and conflict handling are still thin.
- **3. Multi-context switching: 1/3.** Context labels exist, but labels are not context policy.
- **4. Cross-agent shareability: 1/3.** stdio + outbox is durable for one writer domain, not a multi-client concurrency protocol.
- **5. Cross-machine portability: 0/3.** The spec explicitly forbids synced storage and defines no replication or merge semantics.
- **6. Dependency graph correctness: 1/3.** Step 17 adds a second write path before any queue-lease or live-migration invariant is specified.

4. **Disagreement with debate #1/#2**

I disagree with debate #2’s conclusion that the current `derivations` shape plus `(layer, model_id)` is enough to compute rebuild scope; it misses policy-only invalidation entirely. I also partially disagree with debate #1’s stdio MCP + local outbox conclusion for the long-term vision: it is a valid durability primitive, but it is not yet a shareable multi-agent protocol unless the project also commits to one authoritative daemon/lease domain or an explicit replication model.
