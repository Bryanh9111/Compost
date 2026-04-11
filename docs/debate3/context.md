# Debate #3 — Phase 0 Architecture Future-Fitness Stress Test

**Debate ID**: debate3
**Rounds**: 3 (initial → cross-critique → final positions)
**Mode**: cross-critique
**Started**: 2026-04-11
**Participants**: 🔴 Codex, 🟡 Gemini, 🟠 Sonnet, 🐙 Claude (Opus, moderator)

## Scope shift from the user

The original ask was a tactical review of `docs/phase0-checklist.md` (TDD points, time estimates, dependency graph). The user reframed: **don't evaluate the development tactics — evaluate whether the Phase 0 architecture actually sets the foundation for the long-term vision.**

The long-term vision (in the user's words):

> 整体架构的未来可拓展性，像人一样可自己理解进化，也能吸收外部知识的大脑型记忆库，评判以后是否能多context运行（真的像人一样在物理世界多context下环境切换记忆内容，然后可以轻松给不同agent使用，不同机器简单配置），然后依赖图的正确性。

Translated to evaluation axes:

1. **Brain-like self-evolution** — does the L0-L4 + `derivations` + `transform_policy` design support a memory system that learns, re-derives, and improves over time, or is it just a fancy RAG cache that ages?
2. **External knowledge absorption** — can the architecture realistically ingest from new sources beyond the seed adapters without being re-architected?
3. **Multi-context "physical world" switching** — humans switch mental context when they walk into a different room. The schema has `contexts TEXT[]` on facts and sources. Is that mechanism *actually* sufficient for the user's mental model, or is it a JSON-array hack that will fall over the moment two contexts need different freshness rules, different trust tiers, or partial sharing?
4. **Cross-agent shareability** — stdio MCP + adapter pattern. Can multiple distinct host agents (claude-code, openclaw, hermes, airi, generic MCP clients) really share the same memory store concurrently? What breaks under realistic concurrency? Is the single-writer LanceDB mutex a scaling cliff?
5. **Cross-machine portability / "simple config"** — `~/.compost/` is local-disk only (Dropbox/iCloud explicitly forbidden in the spec). How does a user's brain follow them from laptop to desktop to server? Is "rebuild from L0 anchor" actually enough, or is there a missing sync/replication layer?
6. **Dependency graph correctness (Phase 0 only)** — does the 23-step checklist correctly order the build? Hidden cycles, missing prerequisites, mis-ordered TDD points.

The user has explicitly **deferred** evaluation of: time estimates, TDD step selection, parallelization realism, the "should we start with feature-dev or executing-plans" question.

## Reference files (all participants must read these)

- `/Users/zion/Repos/Zylo/Compost/docs/phase0-spec.md` (761 lines) — the executable spec under review
- `/Users/zion/Repos/Zylo/Compost/docs/phase0-checklist.md` (202 lines) — the build-order plan under review
- `/Users/zion/Repos/Zylo/Compost/docs/debate/synthesis.md` — debate #1 (architecture stress test, L0-L4, derivations, hybrid runtime)
- `/Users/zion/Repos/Zylo/Compost/docs/debate2/synthesis.md` — debate #2 (D3 hybrid lock-in, transform_policy convention)

## What each participant must produce

For each round, write 400-600 words covering:

- **Concrete architectural risks** to the long-term vision (not generic platitudes)
- **At least one schema- or interface-level change** that would reduce the risk, with code or SQL where possible
- **Where you disagree with the prior debates' conclusions** — debate1 and debate2 already locked in stdio MCP + adapter outbox + hybrid runtime + date-stamp transform_policy. If you think any of these conflict with the long-term vision, say so and defend it
- **Score axes 1-6 above on a 0-3 scale**: 0 = blocking gap, 1 = significant risk, 2 = adequate but watchable, 3 = solid

In Round 2 and 3, address other participants' specific points by name. The skill quality gate scores you on engagement.

## Decisions previously locked (do not relitigate without justification)

- ✅ Hybrid Node + Python (debate #1 + #2)
- ✅ stdio MCP + adapter outbox (debate #1)
- ✅ `tp-YYYY-MM[-NN]` date-stamp transform_policy with `supersedes` + `migration_notes` (debate #2)
- ✅ L0 ledger schema with raw_bytes + derivations table (debate #1)
- ✅ Auditable Coverage instead of "Complete" guarantee (debate #1)
- ✅ `is_noteworthy()` MinHash + jaccard + fact-delta gate (debate #1)

If you want to overturn any of these, the bar is "this directly conflicts with the long-term vision in a way the prior debates did not consider."
