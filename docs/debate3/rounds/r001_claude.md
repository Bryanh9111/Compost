# R1 — Claude (Opus, Moderator + Participant)

**Role**: independent analysis after reading Gemini, Sonnet, Codex R1. I am not here to summarize them. I am here to name what they collectively missed and directly engage with the strongest point each made.

---

## Meta-observation before the risks

Three independent R1 analyses converged on **one** finding and produced **three non-overlapping** schema proposals:

- **Unanimous**: `contexts TEXT[]` as a JSON column on `facts`/`sources`/`wiki_pages` is not adequate for the user's multi-context vision. All three scored axis 3 as 0 or 1.
- **Non-overlapping schema fixes**: Gemini proposed `context_scopes` with `parent_id` inheritance + `isolation_level`. Sonnet proposed `context` + `fact_context` (with per-context freshness) + `wiki_page_observe`. Codex proposed `derivation_run` with a status lifecycle and partial unique index.

**These three proposals are additive, not competing.** The correct Phase 0 schema diff is all three applied together. I commit to this as the moderator: one context entity table merged from Gemini + Sonnet, plus Codex's derivation_run, plus Sonnet's wiki_page_observe join. See §2 below.

---

## Two risks nobody fully named

### Risk A: Phase 0 has no L0-rebuild verification test

The entire derivations + transform_policy story rests on a premise everyone in debate #1 adopted: **L0 is the rebuild anchor, L1-L3 are disposable views.** `phase0-spec.md:205-209` explicitly states this is a non-negotiable schema requirement. But `phase0-checklist.md` Steps 13 (ingest pipeline) and 18 (doctor reconcile) never *actually rebuild* L1 from L0 and verify output equivalence. Step 13 tests ingest → LanceDB. Step 18 tests count deltas. Nowhere does Phase 0 drop the LanceDB table, replay observations through the ingest pipeline at the same `transform_policy`, and assert the derived chunks match.

**Why this matters for the long-term vision**: if rebuild doesn't actually work byte-for-byte under an unchanged policy, then transform_policy versioning is vapor — there is no guarantee any future rebuild under a new policy produces deterministic output. The user's brain cannot re-derive itself if re-derivation has never been tested.

**Fix**: add Step 13b to the checklist — "Drop `lancedb` table, run `compost doctor --rebuild L1`, assert derived row count matches original and content hashes of at least 3 chunks match fixtures." This costs maybe 40 lines of test code and catches the single biggest unverified assumption in the spec.

### Risk B: the Python extractor contract has no `context` parameter

`phase0-spec.md:415-425` defines the `compost_ingest extract` JSON input schema: `observe_id`, `source_uri`, `mime_type`, `content_ref`, `content`, `transform_policy`. **No context.** This means the extractor produces the same chunks/facts regardless of which context is active when the observation is captured.

The user's vision requires that context shapes *what gets extracted*, not just what gets filtered on query. In "work" context, a Slack message about the product roadmap should become a fact. In "personal" context, the same message should probably not even be promoted to L2. Sonnet + Gemini both want first-class context entities on the storage side, but **even with that fix, contexts can never change extraction behavior** because the extractor subprocess is context-blind.

**Fix**: add `contexts: string[]` and optional `extraction_profile: string` to the §4.2 input schema. The extractor can then select a different prompt or confidence threshold based on active contexts. This is a forward-compatible schema addition: Phase 0 ignores the field, Phase 2+ uses it.

---

## Endorsing Codex's Risk 2 as the strongest technical find

Codex named something neither Gemini nor Sonnet caught: **the `derivations` table primary key is `(observe_id, layer, model_id)` at `phase0-spec.md:135`, which CANNOT represent two rows that differ only in `transform_policy`.** When `tp-2026-04-02` bumps chunk overlap from 100 to 150 without changing the embedding model, the new derivation collides with the existing row. SQLite will either upsert (losing audit history) or reject (blocking the rebuild). Debate #2's synthesis explicitly asserted that `(layer, model_id)` columns are sufficient for rebuild scope detection — Codex just proved that claim wrong.

This is not a design preference. It is a schema correctness bug that blocks the rebuild story the entire architecture depends on. It must be fixed in the Phase 0 migration, not deferred.

---

## Axis scores

| Axis | Opus | Note |
|---|---|---|
| 1. Brain-like self-evolution | **1** | Metadata is set up (derivations + transform_policy). The evolution loop is not — `reflect()` is a no-op stub, L4 is Phase 3, and rebuild is untested (Risk A). All three others scored 1-2; I think they are being generous. |
| 2. External absorption | **2** | Adapter SDK + Python subprocess contract is genuinely extensible. Docked 1 for Risk B (context-blind extractor). |
| 3. Multi-context switching | **0** | Unanimous finding + Risk B extension. Blocking. |
| 4. Cross-agent shareability | **1** | Codex's multi-writer topology is the binding constraint. stdio MCP is 1:1 per process — two claude-code instances would spawn two daemons against one `~/.compost/`, giving you three uncoordinated writers (daemon A + daemon B + embedded CLI). |
| 5. Cross-machine portability | **0** | No export/import, L3 files not reconcilable, rebuild path untested. Matches Gemini + Codex. |
| 6. Dependency graph | **1** | Sonnet's Step 17 implicit embedded-mode assumption is real. I'm docking an additional point for Risk A — the rebuild verification gap is a Phase 0 DoD omission. |

---

## Disagreement with debate #1 and debate #2

I was a participant in both prior debates. I am revising my prior position on two specific points:

1. **Debate #1's "context-based partitioning is sufficient as the primary axis"** (`debate/synthesis.md:289`) — I endorsed this in the original synthesis. The R1 convergence convinces me it was wrong. A JSON-array tag is not partitioning. I yield to Sonnet's and Gemini's finding.

2. **Debate #2's `(layer, model_id)` derivation-key sufficiency** — Codex's Risk 2 proves this does not handle policy-only revisions. The checklist must ship Codex's `derivation_run` table in Step 3, not the current `derivations` table from `phase0-spec.md §1.3`.

These are not relitigations. They are direct conflicts with the long-term vision that the prior debates did not stress-test.
