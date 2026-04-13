# Codex - Round 1

I'll stipulate upfront: the Phase 3 feature list is reasonable in intent. My job is to enumerate the ways it quietly destroys data before anyone notices. Several items have ordering constraints that, if violated, will corrupt live databases with no clean recovery path. Let me be specific.

## 1. Data Integrity Risks in Proposed Schema Changes

**fact_links (deliverable 6): self-referential FK chain breaks sensory GC.**
`fact_links(src_fact_id, dst_fact_id)` will reference `facts(fact_id)`. The critical problem: `facts` uses `ON DELETE CASCADE` from `observations`. When a sensory GC run in `reflect()` deletes observations, the cascade hits `facts`, which must then cascade into `fact_links` -- but only if both FK columns declare `ON DELETE CASCADE`. If either column uses the SQLite default (`NO ACTION`) or `RESTRICT`, the cascade chain `observations -> facts -> fact_links` will raise a FK violation and silently abort the entire sensory GC transaction. The current `reflect.ts` catches this with `skippedDueToFkViolation` but does not retry. Result: GC stops working entirely on any database that has accumulated fact links. This is a silent operational cliff, not a graceful degradation.

**wiki_page_versions (deliverable 9): orphan rows on page deletion.**
`wiki_page_versions` will store snapshots keyed by `page_path`. If a wiki page is removed (topic's facts all archived or tombstoned), version rows are stranded -- `wiki_pages` has no upstream cascade to drive deletion. The `wiki.ts` synthesizer resolves stale pages by path equality; orphaned version rows will accumulate indefinitely with no reachable parent.

**memory_episodic (deliverable 1): links to soft-tombstoned facts.**
If `memory_episodic` references `facts(fact_id)` and the facts table allows soft-tombstone via `archived_at`, the episodic link remains schema-valid but points to a tombstoned, semantically dead fact. If a future hard-delete path is ever added, episode rows will either FK-block the delete or silently orphan, depending on which constraint was declared at migration time. The proposal does not specify this.

**FTS5 external content table: tombstoned facts remain BM25-searchable.**
`facts_fts` is an external-content FTS5 table maintained by triggers. When contradiction arbitration (deliverable 3) tombstones a fact via `UPDATE facts SET archived_at = ...`, the `facts_fts_update` trigger fires and re-indexes the row with its current `subject/predicate/object`. The content is still in the FTS index and will surface in BM25 candidate queries. `findTopicsNeedingSynthesis` in `wiki.ts` filters `archived_at IS NULL` at query time, not at index time -- but BM25 hybrid retrieval does not apply that same filter before RRF fusion. This is a pre-existing bug that deliverable 3 will make significantly more frequent.

## 2. Operational Hazards

**Wiki synthesis holds the process without a lease heartbeat.**
`synthesizeWiki` calls `llm.generate()` in a loop over up to 20 topics. At 2048 tokens per page against gemma4:31b (realistic: 30-120s per call), that is 10-40 minutes of wall time. The daemon's ingest worker in `lease.ts` uses 60-second leases with a heartbeat the caller is responsible for. There is no heartbeat call anywhere in the wiki synthesis path. Any ingest_queue rows whose leases expire during synthesis will be re-claimed, and the daemon -- stuck in synthesis -- will attempt to double-process them when synthesis finishes. This is not a theoretical concern; it is guaranteed to occur on any database with pending queue items.

**wiki.ts writes disk before DB, no wrapping transaction.**
`synthesizePage` executes in this order: (1) LLM generate, (2) `writeFileSync` to disk, (3) `db.run` upsert to `wiki_pages`, (4) `INSERT OR IGNORE INTO wiki_page_observe`. There is no wrapping transaction. If the process crashes between steps 2 and 3, the `.md` file exists on disk but `wiki_pages` has no record of it -- that is just orphaned disk state, recoverable on next run. The dangerous case is the reverse: step 3 succeeds but step 4 hits an FK violation on `observe_id`. The `wiki_pages` row records a synthesis timestamp that is permanently current, `findTopicsNeedingSynthesis` will skip this topic forever, and the `wiki_page_observe` links are incomplete. There is no recovery path without manual intervention.

**Multi-query expansion in the retrieval hot path.**
Deliverable 7 places an LLM call in the retrieval path. If Ollama is unavailable, the fallback behavior is unspecified. If this is in the critical path for all retrieval (not just `compost ask`), a downed Ollama breaks `compost search` entirely. This must be a soft degradation to the original query, not a blocking dependency.

**Daemon process: reflect + wiki synthesis + ingest worker contention.**
`reflect()` is synchronous and the semantic tombstone step batch-updates facts one row at a time inside a transaction (the `tombstoneTx` in `reflect.ts` uses a prepared statement in a loop). On a large database, this holds a write transaction for tens of seconds. Deliverable 4 adds wiki synthesis after reflect. Combined, the daemon is write-blocked from ingest for potentially 20+ minutes per cycle. The lease mechanism in `lease.ts` was not designed for this; the 60-second lease assumes a fast processing loop, not a multi-minute synthesis batch.

## 3. Missing Rollback and Migration Strategies

The proposal names 7 existing migrations and proposes no migration scripts for any of the 9 deliverables. Three items require specific attention:

**Deliverable 6 (fact_links):** The migration must declare `ON DELETE CASCADE` on both FK columns or GC breaks (see above). If deployed and then rolled back, the rollback migration must handle any rows that were written in the interim. There is no plan for this.

**Deliverable 9 (wiki_page_versions):** Requires a decision at migration time about backfill. No backfill = history gap at the migration boundary, making version 1 look like the origin. With backfill = the migration must read disk files and insert content BLOBs; a missing file causes migration failure, leaving the database in a partial state mid-migration.

**Deliverable 3 (contradiction arbitration):** `superseded_by TEXT REFERENCES facts(fact_id)` already exists in `facts` from migration 0001. The arbitration feature starts writing to it. Rolling back requires nulling these references, but there is no migration to distinguish arbitration-written `superseded_by` values from any future manual writes. Rollback is destructive without a tracking column.

## 4. Ordering Dependencies That Corrupt Data If Violated

These are hard constraints, not recommendations:

1. **Deliverable 8 before deliverable 1, 3, 6, and 9.** Semantic chunking changes fact identity. Every table that links to `fact_id` -- episodic memory, fact links, contradiction records, wiki page versions -- will hold stale keys if created before chunking stabilizes. Under the immutable transform policy rule, new chunking = new policy key = new fact UUIDs. Old links are structurally valid but semantically dead.

2. **Deliverable 2 before deliverable 3.** Contradiction arbitration uses `higher-confidence` as a tiebreaker. `w4_importance` feeds importance scores that affect confidence propagation. If arbitration runs while importance scores are still at the schema default (0.5 for all facts), it will incorrectly collapse contradictions that would have resolved differently under real importance weights. The resolution is permanent; there is no undo once `superseded_by` is set.

3. **Deliverable 6 migration must ship before any code that writes to fact_links.** The cascade chain from `observations -> facts -> fact_links` must be correct at the database level before the first link row is inserted. If code ships before the migration, the first sensory GC run against a database with link rows will break.

4. **Deliverable 1 after deliverable 3.** Episode links should point to canonical facts, not to the losing side of a contradiction. Episodic memory is write-once by design; pre-arbitration episodes permanently reference superseded facts if inserted before arbitration resolves them.

**The safe ship order is: 8 -> 2 -> 3 -> 6 -> 1 -> 4+9 -> 7.** Deliverable 5 is a subset of deliverable 4 and must not ship separately -- a wiki rebuild trigger without the contradiction resolution layer produces churn, not improvement.

The most dangerous systemic risk is the interleaved disk+DB write pattern in `wiki.ts` without transactional protection. That is the most likely vector for silent, unrecoverable state corruption in a running production instance. Everything else is fixable with migration discipline. That one requires a code fix before any wiki-touching feature ships.
