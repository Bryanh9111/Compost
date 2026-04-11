# R3 — Claude (Opus) — FINAL POSITIONS + TWO CONCESSIONS + ONE COMPROMISE

**Role**: moderator + participant. R3 is closing. I concede on Q2 and propose a refined Q1 compromise that Codex and Sonnet can both accept.

---

## Final scores

| Decision | R1 | R3 | Change |
|---|---|---|---|
| A | 2/3 | **2/3** | held |
| B | 2/3 | **2/3** | held |
| C | 2/3 | **2/3** | held (reframed in R1) |
| D | 2/3 | **2/3** | held, but **concede on Q2** |

---

## Q1 resolution — refined compromise, not strict dual-emit

I retract my R1 single-emit-with-promotion. Sonnet and Codex correctly identified the failure mode: a misclassified record disappears from `compost.query` over semantic unless every caller bridges tables. That's unacceptable.

But I push back on strict dual-emit (two INSERTs per promoted record) because Gemini is also right: it creates row-bloat and redundant vectors when the UNION view already resolves most of the concern.

**Compromise: episodic as a LINK, not a duplicate.**

- Extractor always emits ONE `facts` row per semantic claim. This is the anchor for `compost.query` semantic search.
- When temporal AND participant metadata are both present, extractor ADDITIONALLY emits ONE `memory_episodic` row that references the fact via `fact_id`, NOT a full copy. The episodic row carries only the episodic-specific metadata: `event_type`, `participants`, `location`, `occurred_at`.
- No redundant vectors. The semantic search over `facts` always hits the anchor. Episodic queries traverse `memory_episodic` then JOIN `facts` on `fact_id`.
- UNION view is not required. Two separate query surfaces with clean semantics: `compost.query` searches semantic facts, `compost.recall_event` (Phase 3) searches episodic records with time/participant filters.

This preserves Sonnet+Codex's correctness guarantee (semantic search never silently misses a promoted record), eliminates Gemini's row-bloat concern (no duplicate vectors or content), and avoids the deterministic classification boundary Opus R1 proposed (Sonnet was right that it was lossy).

Schema:
```sql
CREATE TABLE memory_episodic (
  episodic_id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id),
  event_type TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',   -- JSON
  location TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_episodic_fact ON memory_episodic(fact_id);
CREATE INDEX idx_episodic_time ON memory_episodic(occurred_at);
```

If Sonnet and Codex accept the link-not-duplicate framing, their "semantic retrieval guarantee" is preserved because every episodic record has a corresponding semantic fact that lives in the same search path. If they reject it as insufficient, the full dual-emit fallback (write the fact content into both tables) is acceptable — it's a 2x write cost, not a correctness cost.

## Q2 resolution — CONCEDE

Codex is right and I was wrong. `{async: true}` before durable outbox append moves durability behind the ack boundary. That is exactly what the outbox pattern exists to prevent. I retract Option 2 from my R1.

**Adopted**: synchronous outbox append is mandatory. Hook returns success only after the SQLite WAL commit confirms the outbox row is durable.

**Cold-start mitigation path**: I endorse Sonnet's Phase 0 approach — a pre-bundled CJS shim via `esbuild --bundle --platform=node` that loads ONLY `better-sqlite3`, targeting 20ms cold start (8ms load + 5ms write + 7ms overhead). Phase 0 DoD adds: "Measure `compost hook` cold start; if p95 > 30ms on reference hardware, Phase 1 commits to native Go/Rust binary." This gives the pragmatic path a chance before adding a new language, but forces the upgrade decision with a concrete trigger.

## What I require in the spec (one sentence per decision)

**A**: Spec must mandate `as_of_unix_sec` bind parameter, `half_life_seconds` per-fact column, batched `access_log` (no inline writes), and `compost reflect` owns sensory-tier hard-GC with 7-day TTL.

**B**: Spec must lock `ranking_components` API from Phase 0, require `ranking_audit_log` from Phase 1 even when only w1 is active, pin p50<100ms/p99<500ms SLO on 100K-fact database.

**C**: Spec must use link-not-duplicate for episodic (my compromise above) OR fall back to strict dual-emit if Sonnet+Codex reject the link approach; either way, semantic search guarantee is non-negotiable.

**D**: Spec must mandate synchronous outbox append before hook ack, deterministic `idempotency_key = sha256(adapter||source_id||envelope)`, Phase 0 bundled CJS shim, Phase 1 native binary trigger at p95>30ms cold start.

## Tie-break statement

I concede on Q2 unconditionally. On Q1, if the link-not-duplicate compromise is rejected, I support Sonnet+Codex's strict dual-emit over my own R1 position. Gemini's single-emit-with-promotion is on the table only if the UNION view enforcement is mechanical (gated at `compost-core` query builder, no caller can bypass) — and even then I recommend the link approach because it avoids write bloat entirely.

Ready for synthesis.
