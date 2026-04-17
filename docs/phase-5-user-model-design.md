# Phase 5 — User Model Schema Design

> **Status**: Draft, 2026-04-17
> **Supersedes**: ROADMAP.md Phase 5 "user_profile schema" line-item (section below clarifies why)
> **Scope**: Compost-side schema only. Engram owns raw user state; Compost owns derived patterns.

## Boundary with Engram (anchor v2 reconciliation)

ROADMAP.md:300-304 proposes a Compost-side `user_profile` table with
`preferences` / `blind_spots` / `goals` fields. Engram anchor v2
(`c266b5d41250`) explicitly claims `preference` / `habit` / `goal` as
new `kind` values Engram will own in its memories table.

Same data in two places violates product identity v2:
- Compost = substrate / synthesis
- Engram = hippocampus / raw personal memory

### Resolution

Split the user model across the two systems by **raw vs derived**:

| Data class | Owner | Why |
|---|---|---|
| Explicit user preferences ("I prefer Go over Python") | **Engram** | Raw user statement; `kind=preference` |
| Stated goals ("learn distributed systems this quarter") | **Engram** | `kind=goal` |
| Habits / routines ("meditate every morning") | **Engram** | `kind=habit` |
| Person knowledge ("Alice is my manager") | **Engram** | `kind=person` |
| **Inferred patterns** from observation history (writing style fingerprint, decision heuristics detected from history) | **Compost** | Synthesis; needs LLM / graph traversal |
| **Blind spots** detected algorithmically (topics with no facts despite relevant context) | **Compost** | Synthesis over observations + `open_problems` |
| **Pattern → evidence links** | **Compost** | Provenance chain anchored in observations |

This means Phase 5 Compost-side is **only the derived half**. Raw user
state stays Engram's.

## Compost user model tables (derived side)

### `user_patterns`

Inferred patterns about the user. One row per detected pattern.
Populated by Phase 7 reasoning; schema shipped in Phase 5 so that later
phases have a stable target.

```sql
CREATE TABLE user_patterns (
  pattern_id TEXT PRIMARY KEY,             -- UUIDv7, time-sortable
  pattern_kind TEXT NOT NULL
    CHECK(pattern_kind IN (
      'writing_style',                     -- tone / vocabulary / structure signatures
      'decision_heuristic',                -- "prefers X over Y in context Z"
      'blind_spot',                        -- topic rarely covered despite relevance
      'recurring_question',                -- keeps asking variants of same query
      'skill_growth'                       -- domain depth increasing over time
    )),
  description TEXT NOT NULL,               -- human-readable summary, <= 500 chars
  confidence REAL NOT NULL DEFAULT 0.5,    -- 0..1, derived from evidence strength
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'stale', 'contradicted', 'user_rejected')),

  -- Decay fields: patterns fade if evidence stops accumulating.
  observed_count INTEGER NOT NULL DEFAULT 1,
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reinforced_at_unix_sec INTEGER NOT NULL,
  half_life_seconds INTEGER NOT NULL DEFAULT 7776000,  -- 90 days

  -- Provenance: every pattern must trace back to specific observations.
  derived_from_fact_ids TEXT,              -- JSON array of fact_ids
  derivation_policy TEXT NOT NULL,         -- which reasoning policy produced it

  -- Engram coupling: the pattern's "matching" Engram user kind, if any.
  -- e.g. a detected `decision_heuristic` might be counter-evidence to an
  -- explicit `kind=preference` in Engram.
  engram_memory_id TEXT,

  -- User review: the user can confirm or reject patterns.
  user_reviewed_at TEXT,
  user_verdict TEXT
    CHECK(user_verdict IN (NULL, 'confirmed', 'rejected', 'refined'))
);

CREATE INDEX idx_user_patterns_kind_status
  ON user_patterns(pattern_kind, status, last_reinforced_at_unix_sec);

CREATE INDEX idx_user_patterns_engram
  ON user_patterns(engram_memory_id) WHERE engram_memory_id IS NOT NULL;
```

### `user_pattern_observations`

Many-to-many link from patterns to the observations that evidence
them. Provenance chain parallel to `fact_links`. When an observation is
GC'd (sensory decay), cascade cleans this up.

```sql
CREATE TABLE user_pattern_observations (
  pattern_id TEXT NOT NULL
    REFERENCES user_patterns(pattern_id) ON DELETE CASCADE,
  observe_id TEXT NOT NULL
    REFERENCES observations(observe_id) ON DELETE CASCADE,
  evidence_strength REAL NOT NULL DEFAULT 0.5,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pattern_id, observe_id)
);

CREATE INDEX idx_pattern_obs_observe
  ON user_pattern_observations(observe_id);
```

### `user_pattern_events`

Append-only log of state changes on a pattern (creation, reinforcement,
contradiction, user review). Lets us reconstruct how the user model
evolved over time — critical for Phase 7 "why did you think X?" audit.

```sql
CREATE TABLE user_pattern_events (
  event_id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL
    REFERENCES user_patterns(pattern_id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL
    CHECK(event_kind IN (
      'created', 'reinforced', 'contradicted',
      'confidence_updated', 'status_changed', 'user_reviewed'
    )),
  event_data JSON,                         -- kind-specific payload
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pattern_events_pattern
  ON user_pattern_events(pattern_id, occurred_at);
```

## Why NOT put this in Engram

Engram's hot path is `<50ms p95 zero-LLM recall` (HC-2). Pattern
derivation needs:
- LLM calls for synthesis → violates HC-2 if run in Engram
- Graph traversal over `fact_links` → Engram has no `fact_links` table
- Decay semantics tied to Compost's `observations` GC → Engram has no observations

Patterns are fundamentally synthesized — they belong on Compost's side.
The one-liner in Engram (`origin=compost, kind=insight` per contract)
is how Engram *sees* the resulting insight without owning the
derivation.

## Write path

1. Phase 7 reasoning engine runs on a schedule (reflect daemon).
2. Each pattern-detection policy scans recent facts / observations.
3. On match:
   - Upsert into `user_patterns` (idempotent by deterministic
     `pattern_id = uuidv5(policy || '|' || pattern_signature)`).
   - Insert link rows into `user_pattern_observations`.
   - Append `created` or `reinforced` event.
   - Optionally push a compost-insight to Engram via the adapter (so
     Engram's recall surfaces the pattern).

## Read path

- `compost user-model list` — surfaces active patterns for user review.
- `compost user-model why <pattern_id>` — shows evidence chain.
- `compost ask` queries can filter/boost based on active
  `decision_heuristic` patterns (Phase 7 ranking input).
- Engram pull (`stream_for_compost`) — when Engram exposes `preference`
  / `goal` / `habit` kinds, Compost ingests them as observations,
  letting pattern detection reason about explicit user statements too.

## Migration plan

- Phase 5 Slice A (this design): ship the three tables as a migration
  (proposed: `0015_user_model_schema.sql`) so later phases have a
  stable target. No data written yet.
- Phase 7: ship pattern-detection policies that populate the tables.
- Phase 7+: ship review UX (`compost user-model confirm <id>` etc.).

## PII considerations

User patterns contain highly personal signal. Rules:

1. **No raw credential surfaces** — pattern descriptions must not embed
   credentials from source facts. The `compost doctor --check-pii`
   scanner will be extended to cover `user_patterns.description`.
2. **User-review-first** — patterns stay `status='active'` and invisible
   to any `ask` / pull operation until the user runs a `compost
   user-model list` review pass. Default hidden, not default visible.
3. **Export exclusion** — `compost export` excludes `user_patterns` by
   default; explicit flag required.

## Open sub-questions (not blocking Phase 5 migration)

1. Cross-project patterns: should `user_patterns` include a `project`
   column? Leaning yes, nullable (NULL = cross-project). Aligns with
   Engram scope semantics.
2. Pattern contradiction handling: when a new observation contradicts
   an existing pattern, do we flip `status='contradicted'` or lower
   `confidence`? Leaning lower confidence first, flip only below 0.2.
3. Auto-generated vs user-seeded: should the user be able to add
   patterns manually (e.g. "I am blind to fintech topics, watch for
   that")? Defer to Phase 7 UX design.

Resolve before Phase 7 coding; not required for Phase 5 schema
migration.

## Cross-reference

- Product identity: Compost anchor v2 (`565f184a2fb1`) L6 user model
- Engram kind extension: Engram anchor v2 (`c266b5d41250`)
- Integration contract: `docs/engram-integration-contract.md` §Engram → Compost
- Phase 5 other pre-work: `docs/phase-5-open-questions.md` (insight chain + expires_at)
- Phase 5 gate: `scripts/probe-engram-readiness.ts`
