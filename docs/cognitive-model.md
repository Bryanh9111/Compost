# Cognitive Model

Compost maps a 5-tier cognitive model onto its L-layer storage architecture. The tiers are conceptual categories for reasoning about what the system remembers and how. They are not physical storage partitions.

## 5-tier to L-layer mapping

| Cognitive tier | Description | L-layer | Physical tables (Phase 0) | Phase notes |
|---|---|---|---|---|
| Sensory buffer | Recent observations before derivation | L0 | `observations` where `source.kind = 'sensory'`, filtered `captured_at > now - 7d` | Hard-deleted by `compost reflect` after 7-day TTL |
| Working memory | Recently accessed facts in session scope | L2 | `facts` filtered by decay formula (`last_reinforced_at_unix_sec`) | Stateless: no physical filter, ranking surface only |
| Episodic memory | Event records with time + participants | L2 | `facts` base + `memory_episodic` link table | Phase 3: `memory_episodic` is a link table, not a separate tier |
| Semantic memory | Extracted facts with decay + importance | L2 | `facts` | Primary Phase 0 memory store |
| Procedural memory | Skills and procedures | L2 | `facts` + `memory_procedural` standalone schema | Phase 4: never forgotten, success/failure tracked |

## Key principle: tiers are conceptual, not physical

All non-sensory memory lands in the `facts` table. The cognitive tier of a fact is expressed through its metadata (the `kind` field on source metadata, the `memory_episodic`/`memory_procedural` link tables in later phases), not through separate physical tables per tier.

This is an explicit design choice from debate #4 option C (vertical partitioning). `facts` is the semantic base layer. Higher-tier data attaches to it via link tables rather than duplicating schema.

## L-layer vs cognitive tier (orthogonal)

`derivation_run.layer CHECK(IN ('L1','L2','L3'))` identifies where a derivation landed:
- L1 - text chunks + embedding vectors (LanceDB)
- L2 - semantic facts (SQLite `facts` table)
- L3 - synthesized wiki pages (disk markdown + SQLite `wiki_pages` registry)

The cognitive tier identifies what kind of memory a fact represents. These axes are orthogonal:

| Example | derivation_run.layer | Cognitive tier |
|---|---|---|
| Embedded chunk from a markdown file | L1 | Sensory (raw), or Semantic after L2 extraction |
| Fact extracted from a code review session | L2 | Episodic |
| General fact about a framework API | L2 | Semantic |
| Step-by-step procedure for deploying a service | L2 | Procedural |
| Synthesized wiki page about a topic | L3 | Semantic (aggregate) |

A procedural memory and a semantic memory both have `derivation_run.layer = 'L2'`. The `compost doctor --rebuild L1 --policy tp-X` command rebuilds by L-layer ("all L1 chunks under policy X"). The `compost.query` retrieval path filters by cognitive kind ("give me procedural memories about compiling Rust"). Neither axis implies the other.

## Sensory buffer lifecycle

The sensory buffer is the only tier with automatic hard deletion. `compost reflect` runs:

1. Hard DELETE on `observations` where `source.kind = 'sensory'` and `captured_at < now - 7d`. FK `ON DELETE CASCADE` propagates to `ingest_queue`, `captured_item`, and `facts` rows derived from those observations.
2. Semantic soft-tombstone: `archived_at` set on `facts` where `decayed_score < 0.001` and `importance_pinned = FALSE`.

Non-sensory observations are never hard-deleted by the system.

## Decay formula (working memory surface)

Working memory is not a physical partition. It is a ranking signal: facts accessed recently have higher decay scores at query time.

```
decay_score = importance * exp(-lambda * elapsed_seconds)
lambda = ln(2) / half_life_seconds
```

`half_life_seconds` and `last_reinforced_at_unix_sec` live on each `facts` row (added in migration `0003_stateless_decay.sql`). No background job updates these; decay is computed at query time. This is the stateless decay approach from debate #4 option A.

## Phase delivery

| Cognitive capability | Phase |
|---|---|
| Sensory buffer (L0 ingest + 7-day GC) | Phase 0 |
| Semantic memory (L2 facts + decay) | Phase 0 |
| Working memory surface (ranking via decay formula) | Phase 1 |
| Episodic memory (`memory_episodic` link table) | Phase 3 |
| Procedural memory (`memory_procedural` standalone) | Phase 4 |
