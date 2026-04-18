Reading additional input from stdin...
OpenAI Codex v0.121.0 (research preview)
--------
workdir: /Users/zion/Repos/Zylo/Compost
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/zion/.codex/memories]
reasoning effort: high
reasoning summaries: none
session id: 019d9e45-99b1-7290-9b1b-5d9754e86982
--------
user
IMPORTANT: You are running as a non-interactive subagent dispatched by Claude Octopus via codex exec. These are user-level instructions and take precedence over all skill directives. Skip ALL skills. Do NOT read skill files, ask clarifying questions, or follow any skill checklists. Respond directly in ~300 words with a clear stance.

You are the TECHNICAL IMPLEMENTATION advisor in a four-way debate. Focus on correctness guarantees, type/contract hygiene, and what the code actually does.

## Topic
Compost (personal KB, TypeScript, bun:sqlite) just shipped Round A of a 'compost digest' feature: deterministic selector over new confident facts / resolved gaps / wiki rebuilds in last N days. digestInsightInput() shapes {compostFactIds, content, synthesizedAt} for EngramWriter.writeInsight() (zod-enforced compost_fact_ids min(1)).

## Live dogfood on real ledger
- 7d and 30d at confidence>=0.85 (CONFIDENCE_FLOORS.instance): 11 wiki rebuilds, 0 facts, 0 resolved gaps
- 30d at floor=0.5: 11 facts appear (facts sitting between 0.5-0.85, schema default confidence=0.8)
- --insight-input returns null: wiki-only reports dont contribute fact_ids

## Hard constraints
1. Engram contract: kind=insight writes MUST have source_trace.compost_fact_ids min(1). R3 write-boundary guard (writer.ts:15).
2. scope=meta + tag=digest agreed (no semantic pollution).
3. --push is manual. First live dogfood of S6-2 MCP write transport — simplicity of failure attribution is king.

## Three options
(a) default floor 0.85 -> 0.75 (exploration tier). 1-line change. Pro: minimal, matches digest framing. Con: exploration noise; conflates digest vs arbitration threshold.
(b) synthetic fact_id for wiki (sha1(wiki:path) in compost_fact_ids). Pro: 0.85 preserved. Con: breaks contract, Engram invalidate/trace routes silently no-op, R3 guard becomes fake.
(c) wiki-only -> skip push, print 'no insight-worthy content'. Pro: honest. Con: wiki-active-but-fact-quiet user waits forever, dogfood loop stalls.

## Questions to answer
1. Is (b)s contract break excusable under scope=meta 'meta-level notes' semantics, or does compost_fact_ids strictly mean facts-table rows?
2. For (a), should --confidence-floor stay as override and CLI help note 'digest != arbitration semantics'?
3. Option (d)? e.g. wiki_pages -> contributing_fact_ids via JOIN (wiki_page_observe is in migration 0002 but gives observe_ids not fact_ids).
4. Which option minimizes failure-attribution complexity for the first S6-2 live dogfood?

Pick ONE option (a/b/c/d) and defend. Cite concrete implementation reasoning.
codex
I’m checking the relevant TypeScript paths for the digest selector, `digestInsightInput()`, and the Engram write guard so the recommendation is based on the actual contracts rather than the summary alone.
exec
/bin/zsh -lc "rg -n \"digestInsightInput|writeInsight|compost_fact_ids|source_trace|wiki_page_observe|CONFIDENCE_FLOORS|confidence-floor|insight-input|kind=insight|kind: 'insight'|kind:\\s*\\\"insight\\\"\" ." in /Users/zion/Repos/Zylo/Compost
exec
/bin/zsh -lc "rg --files . | rg \"writer\\.ts"'$|digest|engram|insight|migration|sqlite|schema|fact|wiki_page_observe"' in /Users/zion/Repos/Zylo/Compost
 succeeded in 409ms:
./packages/compost-cli/src/commands/digest.ts
./packages/compost-cli/src/commands/engram-pull.ts
./packages/compost-cli/src/commands/engram-push.ts
./packages/compost-daemon/src/engram-flusher.ts
./packages/compost-daemon/src/engram-poller.ts
./packages/compost-daemon/test/engram-poller.test.ts
./packages/compost-daemon/test/engram-flusher.test.ts
./packages/compost-core/src/schema/0003_stateless_decay.sql
./packages/compost-core/src/schema/0012_correction_signal_kind.sql
./packages/compost-core/src/schema/0006_chunks_and_fts5.sql
./packages/compost-core/src/schema/0005_merged_outbox.sql
./packages/compost-core/src/schema/0008_phase3_ranking.sql
./packages/compost-core/src/schema/0009_phase3_contradiction_and_wiki_versions.sql
./packages/compost-core/src/schema/0016_open_problems.sql
./packages/compost-core/src/schema/0007_phase2_search.sql
./packages/compost-core/src/schema/0013_wiki_stale_at.sql
./packages/compost-core/src/schema/0010_phase4_myco_integration.sql
./packages/compost-core/src/schema/0011_fact_links_and_health_fix.sql
./packages/compost-core/src/schema/0002_debate3_fixes.sql
./packages/compost-core/src/schema/migrator.ts
./packages/compost-core/src/schema/0001_init.sql
./packages/compost-core/src/schema/0004_probabilistic_ranking.sql
./packages/compost-core/src/schema/0015_user_model_schema.sql
./packages/compost-core/src/schema/0014_origin_hash_and_method.sql
./debates/015-compost-engram-roadmap/rounds/r001_sonnet.md
./debates/015-compost-engram-roadmap/rounds/r001_opus.md
./debates/015-compost-engram-roadmap/rounds/r001_gemini.md
./debates/015-compost-engram-roadmap/rounds/r001_codex.md
./debates/015-compost-engram-roadmap/synthesis.md
./debates/015-compost-engram-roadmap/context.md
./packages/compost-core/src/cognitive/digest.ts
./packages/compost-core/src/cognitive/fact-links.ts
./packages/compost-core/test/fact-links.test.ts
./packages/compost-core/test/user-model-schema.test.ts
./packages/compost-core/test/digest.test.ts
./packages/compost-ingest/compost_ingest/schema.py
./packages/compost-ingest/compost_ingest/extractors/llm_facts.py
./packages/compost-ingest/tests/test_schema_contract.py
./packages/compost-engram-adapter/src/stream-puller.ts
./packages/compost-engram-adapter/src/pending-writes.ts
./packages/compost-engram-adapter/src/index.ts
./packages/compost-engram-adapter/src/splitter.ts
./packages/compost-engram-adapter/src/constants.ts
./packages/compost-engram-adapter/src/cli-stream-client.ts
./packages/compost-engram-adapter/src/writer.ts
./packages/compost-engram-adapter/src/mcp-stdio-client.ts
./packages/compost-engram-adapter/src/ingest-adapter.ts
./packages/compost-engram-adapter/tsconfig.json
./packages/compost-engram-adapter/package.json
./packages/compost-engram-adapter/test/stream-puller.test.ts
./packages/compost-engram-adapter/test/cli-stream-client.test.ts
./packages/compost-engram-adapter/test/ingest-adapter.test.ts
./packages/compost-engram-adapter/test/mcp-stdio-client.test.ts
./packages/compost-engram-adapter/test/splitter.test.ts
./packages/compost-engram-adapter/test/pending-writes.test.ts
./packages/compost-engram-adapter/test/writer.test.ts
./docs/engram-integration-contract.md
./scripts/probe-engram-readiness.ts
./debates/018-compost-engram-coupling/context.md
./debates/018-compost-engram-coupling/synthesis.md
./bench/sqlite-query.bench.ts
./debates/022-wiki-only-digest-shaping/context.md
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md
./debates/022-wiki-only-digest-shaping/rounds/r001_gemini.md
./bench/sqlite-reflect.bench.ts
./debates/018-compost-engram-coupling/rounds/r001_sonnet.md
./debates/018-compost-engram-coupling/rounds/r001_opus.md
./debates/018-compost-engram-coupling/rounds/r001_gemini.md
./debates/018-compost-engram-coupling/rounds/r001_codex.md

 succeeded in 440ms:
./packages/compost-cli/src/commands/digest.ts:9:  digestInsightInput,
./packages/compost-cli/src/commands/digest.ts:37:      "--confidence-floor <f>",
./packages/compost-cli/src/commands/digest.ts:50:      "--insight-input",
./packages/compost-cli/src/commands/digest.ts:51:      "Emit the shape that Round B will feed to EngramWriter.writeInsight (JSON)",
./packages/compost-cli/src/commands/digest.ts:64:          const payload = digestInsightInput(report);
./docs/phase-5-open-questions.md:24:| D | Use existing `source_trace` JSON field for chunking metadata | Zero Engram schema change; structure preserved; queryable with `json_extract` |
./docs/phase-5-open-questions.md:27:### Decision: **D — chunking metadata in `source_trace`**
./docs/phase-5-open-questions.md:31:- `source_trace` is already JSON (per contract §Compost → Engram), so adding fields is a Compost-side choice.
./docs/phase-5-open-questions.md:32:- Engram can already query `WHERE json_extract(source_trace, '$.root_insight_id') = ?` using SQLite's native JSON operator.
./docs/phase-5-open-questions.md:44:  "source_trace": {
./docs/phase-5-open-questions.md:45:    "compost_fact_ids": ["...", "..."],
./docs/phase-5-open-questions.md:63:- Same `compost_fact_ids` (the logical insight's full fact set)
./docs/phase-5-open-questions.md:80:`root_insight_id` is deterministic: `uuidv5(NAMESPACE, project || '|' || sorted_compost_fact_ids.join(','))`. Re-running synthesis on the same fact set produces the same `root_insight_id`, so Engram sees an update (Compost invokes `mcp__engram__invalidate_compost_fact` for the fact set, then writes fresh chunks).
./docs/phase-5-open-questions.md:150:- ✅ Design the chunking splitter (`compost-engram-adapter/splitter.ts`) against the `source_trace` chunk metadata schema.
./packages/compost-engram-adapter/src/splitter.ts:11:  compost_fact_ids: string[];
./packages/compost-engram-adapter/src/splitter.ts:23:  source_trace: SourceTrace;
./packages/compost-engram-adapter/src/splitter.ts:63:    compost_fact_ids: sortedFactIds,
./packages/compost-engram-adapter/src/splitter.ts:81:        source_trace: baseTrace(0, 1, "none"),
./packages/compost-engram-adapter/src/splitter.ts:112:    source_trace: baseTrace(i, total, strategy),
./packages/compost-core/test/digest.test.ts:10:  digestInsightInput,
./packages/compost-core/test/digest.test.ts:425:describe("digestInsightInput", () => {
./packages/compost-core/test/digest.test.ts:440:    expect(digestInsightInput(buildDigest(db))).toBeNull();
./packages/compost-core/test/digest.test.ts:461:    const out = digestInsightInput(buildDigest(db));
./packages/compost-core/test/digest.test.ts:478:    const out = digestInsightInput(report);
./packages/compost-engram-adapter/src/writer.ts:11:// R3 mitigation — zod schema for source_trace catches field-name drift at
./packages/compost-engram-adapter/src/writer.ts:15:  compost_fact_ids: z.array(z.string()).min(1),
./packages/compost-engram-adapter/src/writer.ts:31:  kind: "insight";
./packages/compost-engram-adapter/src/writer.ts:35:  source_trace: SourceTrace;
./packages/compost-engram-adapter/src/writer.ts:111:  async writeInsight(
./packages/compost-engram-adapter/src/writer.ts:118:    const rootInsightId = chunks[0]!.source_trace.root_insight_id;
./packages/compost-engram-adapter/src/writer.ts:127:      validateSourceTrace(chunk.source_trace);
./packages/compost-engram-adapter/src/writer.ts:141:          chunk_index: chunk.source_trace.chunk_index,
./packages/compost-engram-adapter/src/writer.ts:142:          total_chunks: chunk.source_trace.total_chunks,
./packages/compost-engram-adapter/src/writer.ts:152:          chunk_index: chunk.source_trace.chunk_index,
./packages/compost-engram-adapter/src/writer.ts:153:          total_chunks: chunk.source_trace.total_chunks,
./packages/compost-engram-adapter/src/writer.ts:232:      kind: "insight",
./packages/compost-engram-adapter/src/writer.ts:236:      source_trace: chunk.source_trace,
./packages/compost-core/test/audit.test.ts:8:  CONFIDENCE_FLOORS,
./packages/compost-core/test/audit.test.ts:47:  test("CONFIDENCE_FLOORS exports kernel/instance/exploration tiers", () => {
./packages/compost-core/test/audit.test.ts:48:    expect(CONFIDENCE_FLOORS.kernel).toBe(0.9);
./packages/compost-core/test/audit.test.ts:49:    expect(CONFIDENCE_FLOORS.instance).toBe(0.85);
./packages/compost-core/test/audit.test.ts:50:    expect(CONFIDENCE_FLOORS.exploration).toBe(0.75);
./docs/compost-v2-spec.md:46:1. `wiki_page_observe.observe_id` missing `ON DELETE CASCADE` (Sonnet + Gemini + Opus)
./docs/compost-v2-spec.md:80:│   │   │   │   ├── 0002_debate3_fixes.sql     # derivation_run, policies, context, wiki_page_observe, queue lease
./docs/compost-v2-spec.md:288:-- L3 wiki page registry (actual markdown on disk; debate #3 replaced contributing_observes TEXT with wiki_page_observe)
./docs/compost-v2-spec.md:374:CREATE TABLE wiki_page_observe (
./docs/compost-v2-spec.md:380:CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
./docs/compost-v2-spec.md:468:6. `wiki_page_observe` normalized join replacing JSON array
./docs/compost-v2-spec.md:1454:    // derivation_run.observe_id and wiki_page_observe.observe_id also cascade (debate #3 schema).
./docs/compost-v2-spec.md:1624:| L3 freshness derived from L2 via `wiki_page_observe` join | debate #3 | no more JSON-array scans |
./docs/engram-integration-contract.md:38:- Compost writes back to Engram as a **new origin** (e.g. `origin=compost` or a new `kind=insight`) — Engram marks these entries as externally sourced, eligible for user review, and distinct from `origin=human` / `origin=agent`.
./docs/engram-integration-contract.md:57:  "source_trace": {
./docs/engram-integration-contract.md:58:    "compost_fact_ids": ["<fact_id>", "..."],
./docs/engram-integration-contract.md:73:> - `source_trace` and `expires_at` are **both mandatory** — no optional fields.
./docs/engram-integration-contract.md:80:- `source_trace` always present — insights are always traceable back to Compost facts
./docs/engram-integration-contract.md:83:- Idempotency: same `(project, source_trace.compost_fact_ids)` produces the same deterministic insight ID — Compost won't spam Engram with duplicates on repeated synthesis
./docs/engram-integration-contract.md:87:- Write API: **reuses existing `mcp__engram__remember`** tool with `origin='compost'` + `kind='insight'` + `source_trace` + `expires_at`. Engram's `_map_insight_sources` auto-populates the internal `compost_insight_sources` table from `source_trace.compost_fact_ids` on insert — no separate `write_compost_insight` tool exists.
./docs/engram-integration-contract.md:98:- Compost invokes **MCP tool `mcp__engram__invalidate_compost_fact`** with the affected `compost_fact_ids[]` (per debate 019 Q7 — no HTTP webhook)
./docs/engram-integration-contract.md:171:- **Engram v3.3 / v3.4 Slice A** (shipped): schema work (unpin, scope, CHECK, origin=compost literal, expires_at, source_trace columns)
./packages/compost-core/src/cognitive/digest.ts:2:import { CONFIDENCE_FLOORS } from "./audit";
./packages/compost-core/src/cognitive/digest.ts:13: * Dry-run only in this slice — no Engram push. `digestInsightInput()` shapes
./packages/compost-core/src/cognitive/digest.ts:15: * `EngramWriter.writeInsight()` without reshaping here.
./packages/compost-core/src/cognitive/digest.ts:68:  const confidenceFloor = opts.confidenceFloor ?? CONFIDENCE_FLOORS.instance;
./packages/compost-core/src/cognitive/digest.ts:237:export function digestInsightInput(
./packages/compost-core/test/migrator.test.ts:95:      "wiki_page_observe",
./packages/compost-core/src/cognitive/audit.ts:7:export const CONFIDENCE_FLOORS = {
./packages/compost-core/src/cognitive/audit.ts:13:export type ConfidenceTier = keyof typeof CONFIDENCE_FLOORS;
./packages/compost-core/src/cognitive/audit.ts:117:  const floor = CONFIDENCE_FLOORS[entry.confidenceTier];
./docs/phase-5-user-model-design.md:142:The one-liner in Engram (`origin=compost, kind=insight` per contract)
./packages/compost-core/src/cognitive/reflect.ts:3:import { recordDecision, TIER_FOR_KIND, CONFIDENCE_FLOORS } from "./audit";
./packages/compost-core/src/cognitive/reflect.ts:70:      // captured_item, derivation_run, wiki_page_observe
./packages/compost-core/src/cognitive/reflect.ts:278:                confidenceActual: CONFIDENCE_FLOORS[TIER_FOR_KIND.contradiction_arbitration],
./packages/compost-core/src/schema/0001_init.sql:108:-- L3 wiki page registry (actual markdown on disk; debate #3 replaced contributing_observes TEXT with wiki_page_observe)
./packages/compost-engram-adapter/test/mcp-stdio-client.test.ts:32:    kind: "insight",
./packages/compost-engram-adapter/test/mcp-stdio-client.test.ts:36:    source_trace: {
./packages/compost-engram-adapter/test/mcp-stdio-client.test.ts:37:      compost_fact_ids: ["f1"],
./packages/compost-engram-adapter/test/mcp-stdio-client.test.ts:94:      content: [{ type: "text", text: "source_trace required" }],
./packages/compost-engram-adapter/test/mcp-stdio-client.test.ts:99:    expect(r.error).toContain("source_trace");
./packages/compost-core/src/cognitive/wiki.ts:10:import { recordDecision, TIER_FOR_KIND, CONFIDENCE_FLOORS } from "./audit";
./packages/compost-core/src/cognitive/wiki.ts:159:  // Link wiki page to source observations via wiki_page_observe
./packages/compost-core/src/cognitive/wiki.ts:168:    "INSERT OR IGNORE INTO wiki_page_observe (page_path, observe_id, linked_at) VALUES (?, ?, datetime('now'))"
./packages/compost-core/src/cognitive/wiki.ts:185:      confidenceActual: CONFIDENCE_FLOORS[TIER_FOR_KIND.wiki_rebuild],
./packages/compost-engram-adapter/test/splitter.test.ts:50:    expect(chunks[0].source_trace.total_chunks).toBe(1);
./packages/compost-engram-adapter/test/splitter.test.ts:51:    expect(chunks[0].source_trace.chunk_index).toBe(0);
./packages/compost-engram-adapter/test/splitter.test.ts:52:    expect(chunks[0].source_trace.split_strategy).toBe("none");
./packages/compost-engram-adapter/test/splitter.test.ts:63:    expect(bare.source_trace.compost_wiki_path).toBeUndefined();
./packages/compost-engram-adapter/test/splitter.test.ts:64:    expect(bare.source_trace.derivation_run_id).toBeUndefined();
./packages/compost-engram-adapter/test/splitter.test.ts:74:    expect(full.source_trace.compost_wiki_path).toBe("docs/wiki.md");
./packages/compost-engram-adapter/test/splitter.test.ts:75:    expect(full.source_trace.derivation_run_id).toBe("run-42");
./packages/compost-engram-adapter/test/splitter.test.ts:95:      expect(c.source_trace.split_strategy).toBe("paragraph");
./packages/compost-engram-adapter/test/splitter.test.ts:98:    const root = chunks[0].source_trace.root_insight_id;
./packages/compost-engram-adapter/test/splitter.test.ts:100:      expect(c.source_trace.root_insight_id).toBe(root);
./packages/compost-engram-adapter/test/splitter.test.ts:101:      expect(c.source_trace.total_chunks).toBe(chunks.length);
./packages/compost-engram-adapter/test/splitter.test.ts:102:      expect(c.source_trace.synthesized_at).toBe(NOW);
./packages/compost-engram-adapter/test/splitter.test.ts:105:    chunks.forEach((c, i) => expect(c.source_trace.chunk_index).toBe(i));
./packages/compost-engram-adapter/test/splitter.test.ts:128:    expect(chunks[0].source_trace.split_strategy).toBe("sentence");
./packages/compost-engram-adapter/test/splitter.test.ts:145:    expect(chunks[0].source_trace.split_strategy).toBe("hard-cut");
./packages/compost-engram-adapter/test/splitter.test.ts:199:        source_trace: {
./packages/compost-engram-adapter/test/splitter.test.ts:200:          compost_fact_ids: ["f1"],
./packages/compost-engram-adapter/test/splitter.test.ts:210:        source_trace: {
./packages/compost-engram-adapter/test/splitter.test.ts:211:          compost_fact_ids: ["f1"],
./packages/compost-core/src/schema/0002_debate3_fixes.sql:3:-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
./packages/compost-core/src/schema/0002_debate3_fixes.sql:80:CREATE TABLE wiki_page_observe (
./packages/compost-core/src/schema/0002_debate3_fixes.sql:86:CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
./packages/compost-engram-adapter/test/pending-writes.test.ts:23:      payload: { content: "c", kind: "insight" },
./packages/compost-engram-adapter/test/pending-writes.test.ts:31:      kind: "insight",
./packages/compost-engram-adapter/test/pending-writes.test.ts:57:      { content: "new insight", source_trace: { compost_fact_ids: ["f1", "f2"] } }
./packages/compost-daemon/test/engram-flusher.test.ts:48:        kind: "insight",
./packages/compost-daemon/test/engram-flusher.test.ts:52:        source_trace: { compost_fact_ids: ["f1"] },
./packages/compost-engram-adapter/test/writer.test.ts:69:    const result = await writer.writeInsight({
./packages/compost-engram-adapter/test/writer.test.ts:86:    const result = await writer.writeInsight({
./packages/compost-engram-adapter/test/writer.test.ts:94:      client.rememberCalls.map((c) => c.source_trace.root_insight_id)
./packages/compost-engram-adapter/test/writer.test.ts:106:    const result = await writer.writeInsight({
./packages/compost-engram-adapter/test/writer.test.ts:119:    const result = await writer.writeInsight({
./packages/compost-engram-adapter/test/writer.test.ts:148:    await writer.writeInsight({
./packages/compost-engram-adapter/test/writer.test.ts:166:    await writer.writeInsight({
./packages/compost-engram-adapter/test/writer.test.ts:180:  test("validateSourceTrace rejects missing compost_fact_ids (R3)", () => {
./packages/compost-engram-adapter/test/writer.test.ts:208:        compost_fact_ids: ["f1"],
./docs/ARCHITECTURE.md:117:wiki_pages.path CASCADE -> wiki_page_observe
./docs/debate3/rounds/r001_sonnet.md:76:CREATE TABLE wiki_page_observe (
./docs/debate3/rounds/r001_sonnet.md:83:CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
./docs/debate3/rounds/r001_sonnet.md:102:FROM wiki_page_observe wpo
./docs/debate5/rounds/sonnet_review.md:41:`observations` is the FK parent of `ingest_queue` (ON DELETE not specified in §1.1, defaults to RESTRICT), `derivation_run` (ON DELETE CASCADE per §1.2), `captured_item` (no ON DELETE in §1.1), and `wiki_page_observe` (ON DELETE CASCADE per §1.2). With `PRAGMA foreign_keys = ON` (required by §1.1), this DELETE will hard-fail on any row that still has an `ingest_queue` or `captured_item` child, silently under-deleting without any error surfacing to the caller. The `ReflectionReport` struct returns only `sensoryDeleted` count - there is no field for "skipped due to FK violation."
./docs/ROADMAP.md:323:      `writeInsight` / `invalidateFacts` / `flushPending`; takes
./docs/ROADMAP.md:396:- Push (Compost → Engram): reuses `mcp__engram__remember(origin='compost', kind='insight', source_trace, expires_at)`. Engram's `_map_insight_sources` auto-fills `compost_insight_sources` from `source_trace.compost_fact_ids`. No separate write tool.
./docs/ROADMAP.md:403:- Insight chunking uses `source_trace` JSON (`root_insight_id` + `chunk_index` + `total_chunks`) — zero Engram schema change.
./docs/ROADMAP.md:424:    fallback) and `digestInsightInput()` reshapes into `{compostFactIds, content,
./docs/ROADMAP.md:425:    synthesizedAt}` — Round B will feed this straight into `EngramWriter.writeInsight()`.
./docs/ROADMAP.md:426:  - `compost digest` CLI: `--since-days` (default 7), `--confidence-floor` (default
./docs/ROADMAP.md:427:    CONFIDENCE_FLOORS.instance = 0.85), `--max-items` per group, `--json`, and
./docs/ROADMAP.md:428:    `--insight-input` to preview Round B payload. **No `--push` flag yet** — first
./docs/ROADMAP.md:431:- 📋 **P0 slice 2 Round B** — wire `compost digest --push` → `EngramWriter.writeInsight`
./docs/debate3/rounds/r003_claude.md:38:4. `wiki_page_observe` join table (replaces `contributing_observes` JSON)
./docs/debate3/rounds/r003_claude.md:114:-- (4) wiki_page_observe replaces contributing_observes JSON
./docs/debate3/rounds/r003_claude.md:115:CREATE TABLE wiki_page_observe (
./docs/debate3/rounds/r003_claude.md:121:CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
./docs/debate4/rounds/r001_sonnet.md:47:**Formula drift between query paths.** The formula as written applies to `compost.query` results. But `compost.ask` (Phase 2) will call an LLM that synthesizes from L3 wiki pages. Wiki pages are synthesized from `facts` via `wiki_page_observe`. If the ranking formula promotes memory X in `compost.query` but the wiki synthesis weights are computed at synthesis time (not retrieval time), the two paths diverge: the user sees "result X" in query mode but wiki-synthesized answer "Y" because X was stale when the wiki was last built. This is not a formula correctness problem — it is an architectural coherence problem. You now have two independent ranking surfaces (real-time formula + pre-computed synthesis) that can contradict each other with no reconciliation protocol.
./docs/debate5/rounds/codex_review.md:14:3. **§8.4 vs §1.1/§1.2 (`lines 910-913` vs `197-202`, `214-215`, `309-313`)**. Failure mode: `reflect()` hard-deletes from `observations`, but `captured_item.observe_id`, `facts.observe_id`, and `wiki_page_observe.observe_id` all reference `observations` without `ON DELETE CASCADE`. Once a sensory observation has downstream facts or coverage rows, the DELETE will fail under `PRAGMA foreign_keys = ON`. Concrete fix: either state that `source.kind='sensory'` rows are never derivation inputs and enforce that at queue admission, or change the GC model to soft-delete observations / cascade-delete all dependent rows intentionally.
./docs/debate3/rounds/r001_claude.md:12:- **Non-overlapping schema fixes**: Gemini proposed `context_scopes` with `parent_id` inheritance + `isolation_level`. Sonnet proposed `context` + `fact_context` (with per-context freshness) + `wiki_page_observe`. Codex proposed `derivation_run` with a status lifecycle and partial unique index.
./docs/debate3/rounds/r001_claude.md:14:**These three proposals are additive, not competing.** The correct Phase 0 schema diff is all three applied together. I commit to this as the moderator: one context entity table merged from Gemini + Sonnet, plus Codex's derivation_run, plus Sonnet's wiki_page_observe join. See §2 below.
./docs/debate3/rounds/r002_codex.md:1:Gemini and Sonnet are right that context must become a first-class entity, but Opus overstates the “all additive” framing unless migration order is explicit. `derivation_run` has precedence over `context`/`fact_context`/`context_scopes`, because Phase 0 first needs a correct replay identity before it can safely add context-sensitive freshness or inheritance. If you ship Sonnet’s `fact_context.freshness` while `derivations` still collapse policy-only reruns under `(observe_id, layer, model_id)`, the system can mark a fact stale in one context but still be unable to prove which derivation produced the current artifact. So the order is: replace `derivations` with `derivation_run`; normalize `wiki_page_observe`; then add a merged Sonnet+Gemini context table (`context_scope` with `parent_id`, `isolation_level`, and per-context freshness/trust settings). Compatible, yes; commutative, no.
./docs/debate3/rounds/r003_gemini.md:67:4. `fact_context(fact_id, context_id, freshness)` & `wiki_page_observe(path, observe_id)` — Full normalization, no JSON arrays.
./docs/debate3/rounds/r003_codex.md:5:5. **Q5**: Hold my R2 order: `derivation_run` first, then `wiki_page_observe`, then first-class context tables, because freshness-by-context is meaningless until replay identity is correct.
./docs/debate3/rounds/r003_codex.md:12:- Replace `wiki_pages.contributing_observes` JSON with `wiki_page_observe(page_path, observe_id, PRIMARY KEY(page_path, observe_id))`.
./scripts/probe-engram-readiness.ts:24: *   memories.source_trace column present
./scripts/probe-engram-readiness.ts:178:    // source_trace column
./scripts/probe-engram-readiness.ts:179:    const hasSourceTrace = cols.some((c) => c.name === "source_trace");
./scripts/probe-engram-readiness.ts:182:      label: "memories.source_trace column exists",
./scripts/probe-engram-readiness.ts:185:        ? "source_trace present"
./scripts/probe-engram-readiness.ts:186:        : "source_trace missing (Engram Phase 2 drift fix pending)",
./docs/debate3/rounds/r003_sonnet.md:20:Concede to Codex. Order is: (1) `derivation_run` + partial unique index, (2) `policies` table, (3) `context` entity + `fact_context` join, (4) `wiki_page_observe` join, (5) lease columns on `ingest_queue`. Each migration is independently deployable in this sequence.
./docs/debate3/rounds/r003_sonnet.md:33:6. `wiki_page_observe(page_path, observe_id, linked_at)` -- replaces `wiki_pages.contributing_observes TEXT`
./docs/debate5/rounds/r2_sonnet_review.md:16:### 2a. `wiki_page_observe.observe_id` missing FK CASCADE
./docs/debate5/rounds/r2_sonnet_review.md:20:The `wiki_page_observe` join table declares:
./docs/debate5/rounds/r2_sonnet_review.md:24:No `ON DELETE CASCADE`. Every other child-of-`observations` table (ingest_queue at line 204, captured_item at line 229, facts at line 245, derivation_run at line 276) received ON DELETE CASCADE via debate #5 fix pass. `wiki_page_observe` was supposed to get it too — §8.4's reflection pseudocode at line 1271 explicitly comments "derivation_run.observe_id and wiki_page_observe.observe_id also cascade (debate #3 schema)" — but the actual DDL at line 342 does NOT have CASCADE. This means `compost reflect` sensory GC will FOREIGN KEY fail the moment any sensory observation has an associated `wiki_page_observe` row, which is exactly the failure mode the v2.1 patch claimed to fix. The `skippedDueToFkViolation` counter in `ReflectionReport` (line 1241) will be non-zero in this scenario, and the DoD gate at line 1587 ("asserts... `skippedDueToFkViolation = 0`") will fail.
./docs/debate5/rounds/r2_sonnet_review.md:26:**Fix**: Add `ON DELETE CASCADE` to `wiki_page_observe.observe_id` in migration 0002.
./docs/debate5/rounds/r2_sonnet_review.md:83:| `skippedDueToFkViolation = 0` DoD gate | §11 line 1587 | §8.4 `ReflectionReport` line 1241 | Consistent on the field name. But §8.4 line 1271 claims `wiki_page_observe` cascades; §1.2 line 342 does NOT have CASCADE. The DoD gate will catch this in tests, but only if the test inserts a `wiki_page_observe` row for a sensory observation — the spec does not require that. |
./docs/debate5/rounds/r2_sonnet_review.md:95:I would not approve this for coding today — but I'm close. The `wiki_page_observe` missing CASCADE is a verified bug: the spec's own pseudocode (§8.4) asserts this cascade exists and the DoD gate tests for zero FK violations, but the actual DDL does not have it, meaning every reflect run that touches a sensory-sourced wiki-linked observation will fail the gate. That is a one-line DDL fix, not an architectural debate, and it needs to land before the first engineer writes the migration file. The context-binding bug in the §5.1 query pseudocode is Phase 1-active code, not Phase 0, so it cannot block Phase 0 ship — but it should be corrected in the spec now while the pseudocode is being read by implementers, not discovered during Phase 1 debugging. The `extraction_timeout_sec` phantom field is a spec consistency error introduced by the v2.1 patch itself. These three fixes are mechanical. The cognitive architecture is well-thought-out, the crash-recovery matrix is thorough, the FK cascade story (except wiki_page_observe) is sound, and the stateless decay formula is correctly isolated from rebuild identity. Fix the three items above, verify §1.2 DDL vs. §8.4 prose alignment explicitly in the DoD, and this is ready.
./docs/debate9-phase3-plan/codex-r1.md:25:`synthesizePage` executes in this order: (1) LLM generate, (2) `writeFileSync` to disk, (3) `db.run` upsert to `wiki_pages`, (4) `INSERT OR IGNORE INTO wiki_page_observe`. There is no wrapping transaction. If the process crashes between steps 2 and 3, the `.md` file exists on disk but `wiki_pages` has no record of it -- that is just orphaned disk state, recoverable on next run. The dangerous case is the reverse: step 3 succeeds but step 4 hits an FK violation on `observe_id`. The `wiki_pages` row records a synthesis timestamp that is permanently current, `findTopicsNeedingSynthesis` will skip this topic forever, and the `wiki_page_observe` links are incomplete. There is no recovery path without manual intervention.
./docs/debate3/synthesis.md:77:4. `wiki_page_observe` join (replaces `contributing_observes` JSON)
./docs/debate3/synthesis.md:168:-- (4) wiki_page_observe replaces contributing_observes JSON
./docs/debate3/synthesis.md:169:CREATE TABLE wiki_page_observe (
./docs/debate3/synthesis.md:175:CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
./docs/debate3/synthesis.md:287:| `wiki_page_observe` normalized join (remove `contributing_observes` JSON) | ✅ Ship Phase 0 |
./docs/debate3/synthesis.md:308:- **§1.7**: remove `contributing_observes TEXT` from `wiki_pages`; add reference to `wiki_page_observe` join
./docs/debate3/synthesis.md:309:- **§1**: add `policies`, `context`, `fact_context`, `source_context`, `wiki_page_observe` tables
./docs/debate3/synthesis.md:331:- fact_context / source_context / wiki_page_observe: ~3 hours
./docs/debate5/rounds/r2_gemini_review.md:18:*   **§1.2 / §8.4 — Broken Sensory-GC Chain:** The v2.1 patch pass correctly added `ON DELETE CASCADE` to most tables, but missed `wiki_page_observe` in §1.2. The DDL for `wiki_page_observe.observe_id` is missing the cascade, despite §8.4 explicitly claiming it cascades. In Phase 0, any attempt by `compost reflect` to delete a sensory observation linked to a wiki page will be blocked by a `RESTRICT` error, halting the GC loop.
./docs/CONCEPTS.md:145:                                                         source_trace + expires_at)
./debates/022-wiki-only-digest-shaping/rounds/r001_gemini.md:7:Option (b) is an architectural "poison pill." Synthetic IDs like `sha1("wiki:"+path)` bypass the R3 write-boundary guard, transforming a safety mechanism into a facade. If Engram later attempts to invalidate, trace, or refresh this insight, the synthetic ID will cause silent failures or referential 404s. `compost_fact_ids` must strictly represent a "row in the facts table" to maintain the integrity of the bidirectional link.
./debates/022-wiki-only-digest-shaping/rounds/r001_gemini.md:19:- **Failure Attribution:** Minimizes complexity because the `source_trace` is real. If the push fails or the insight is questioned, the developer can query the `facts` table and see the exact audit record for that digest generation.
./debates/022-wiki-only-digest-shaping/context.md:10:Compost 是个人 KB。Phase 5 已通双向 Engram MCP。Round A 刚落地 `compost digest` selector (deterministic，扫最近 N 天的 new_facts / resolved_gaps / wiki_rebuilds)，dry-run 可用。`digestInsightInput()` 把报告塑形成 `{compostFactIds, content, synthesizedAt}` 喂给 `EngramWriter.writeInsight()`。
./debates/022-wiki-only-digest-shaping/context.md:14:- default `--since-days 7` / `--confidence-floor 0.85`：11 wiki rebuild，0 fact，0 resolved gap
./debates/022-wiki-only-digest-shaping/context.md:16:- `--confidence-floor 0.5 --since-days 30`：冒出 11 条 fact（都压在 0.5-0.85 之间）
./debates/022-wiki-only-digest-shaping/context.md:18:- `--insight-input` → `null`（wiki-only 不贡献 fact_id）
./debates/022-wiki-only-digest-shaping/context.md:22:1. **Engram 合约**: Compost 写入 `kind=insight` 必须带 `source_trace.compost_fact_ids` (zod `min(1)`, writer.ts:15). R3 写边界校验.
./debates/022-wiki-only-digest-shaping/context.md:34:`sha1("wiki:"+path)` 作 fake fact_id 塞 compost_fact_ids。
./debates/022-wiki-only-digest-shaping/context.md:38:`digestInsightInput() === null` → 打印 "no insight-worthy content"。
./debates/022-wiki-only-digest-shaping/context.md:43:1. (b) 的合约破坏是否被 scope=meta 的 "meta-level notes" 语义豁免？还是说 compost_fact_ids 必须严格是 facts 表行 id？
./debates/022-wiki-only-digest-shaping/context.md:44:2. (a) 改默认到 0.75，是否应保留 `--confidence-floor` 覆盖 + 在 CLI help 标注 "digest 语义 != arbitration 语义"？
./debates/022-wiki-only-digest-shaping/context.md:45:3. 有没有第四条路？比如 wiki_pages 接一个 `contributing_fact_ids` join (spec 是否有？现状是 `wiki_page_observe` 在 0002 migration)？
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:19:Compost (personal KB, TypeScript, bun:sqlite) just shipped Round A of a 'compost digest' feature: deterministic selector over new confident facts / resolved gaps / wiki rebuilds in last N days. digestInsightInput() shapes {compostFactIds, content, synthesizedAt} for EngramWriter.writeInsight() (zod-enforced compost_fact_ids min(1)).
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:22:- 7d and 30d at confidence>=0.85 (CONFIDENCE_FLOORS.instance): 11 wiki rebuilds, 0 facts, 0 resolved gaps
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:24:- --insight-input returns null: wiki-only reports dont contribute fact_ids
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:27:1. Engram contract: kind=insight writes MUST have source_trace.compost_fact_ids min(1). R3 write-boundary guard (writer.ts:15).
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:33:(b) synthetic fact_id for wiki (sha1(wiki:path) in compost_fact_ids). Pro: 0.85 preserved. Con: breaks contract, Engram invalidate/trace routes silently no-op, R3 guard becomes fake.
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:37:1. Is (b)s contract break excusable under scope=meta 'meta-level notes' semantics, or does compost_fact_ids strictly mean facts-table rows?
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:38:2. For (a), should --confidence-floor stay as override and CLI help note 'digest != arbitration semantics'?
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:39:3. Option (d)? e.g. wiki_pages -> contributing_fact_ids via JOIN (wiki_page_observe is in migration 0002 but gives observe_ids not fact_ids).
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:44:I’m checking the relevant TypeScript paths for the digest selector, `digestInsightInput()`, and the Engram write guard so the recommendation is based on the actual contracts rather than the summary alone.
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:46:/bin/zsh -lc "rg -n \"digestInsightInput|writeInsight|compost_fact_ids|source_trace|wiki_page_observe|CONFIDENCE_FLOORS|confidence-floor|insight-input|kind=insight|kind: 'insight'|kind:\\s*\\\"insight\\\"\" ." in /Users/zion/Repos/Zylo/Compost
./debates/022-wiki-only-digest-shaping/rounds/r001_codex.md:48:/bin/zsh -lc "rg --files . | rg \"writer\\.ts"'$|digest|engram|insight|migration|sqlite|schema|fact|wiki_page_observe"' in /Users/zion/Repos/Zylo/Compost
./debates/020-phase-5-session-4-slicing/rounds/r001_claude.md:11:Contract §Compost→Engram 明写: 不存在独立 `write_compost_insight` tool. Compost 的 writer.ts 不写 `remember`, 就没有任何客户端测得到 Engram 的 `compost_insight_sources` 反查表是否真的被正确填充. 这个表是 `invalidate_compost_fact` 的反查索引, 如果 writer 侧 source_trace.compost_fact_ids 格式与 Engram `_map_insight_sources` 解析不一致 (e.g. 字段名 drift), 后续 invalidate 会静默失败 — 测不到, 但会在用户发现 "insight 说废了却还在 recall" 时才暴露. **Session 4 不落 writer, 这个 drift 没有 fixture 能锁定.**
./debates/020-phase-5-session-4-slicing/rounds/r001_claude.md:28:### 1. `source_trace` JSON schema 未冻结就写 writer
./debates/020-phase-5-session-4-slicing/rounds/r001_claude.md:30:Contract 只列了字段名, 没给出 JSON Schema 校验器. 如果 writer.ts 直接手写 `{compost_fact_ids: [...], root_insight_id: ...}` 而不用 zod/ajv 校验, 一旦 Phase 7 reasoning 调 writer 时字段名敲错 (e.g. `compost_fact_id` 单数), Engram 接收后 `_map_insight_sources` 看不到任何 fact_ids, `compost_insight_sources` 反查表空. 错误 silent. **Mitigation**: writer.ts 第一个函数应该是 `validateSourceTrace(): SourceTrace` (zod schema), 非可选.
./debates/020-phase-5-session-4-slicing/rounds/r001_claude.md:53:B 执行时, **先写 writer 的 zod source_trace schema + splitter 的 UUIDv5 namespace 常量 (单 constants.ts)** — 这两个是 Sonnet/我都点到的 drift 风险点, 放在两个模块之间的共享文件, 强制两侧 import 同一 source.
./debates/020-phase-5-session-4-slicing/synthesis.md:21:`remember(origin='compost')` 是 Engram `_map_insight_sources` 的唯一触发点 — 不落 writer, `compost_insight_sources` 反查表没有 fixture 锁 drift. Option D 表面 350 LoC, 实际需要新 Migration + origin_hash 路径改造 (Migration 0014 刚落地), 实际量级更接近 500. Migration 0015 搭便车成本 <30 分钟, 做了省一次 context switch. 两个补充风险: (a) `source_trace` JSON schema 未用 zod/ajv 校验会 silent failure; (b) `expires_at` drift 的极端情况 — flush 时已超 grace window, remember 成功但立即 GC, writer 看到 success response 但数据 0 秒后就没.
./debates/020-phase-5-session-4-slicing/synthesis.md:46:| R3 | `source_trace` JSON schema 未冻结 silent failure | Opus | writer.ts 第一个导出函数 `validateSourceTrace` (zod/ajv), 非可选 |
./debates/020-phase-5-session-4-slicing/synthesis.md:78:   - `writeInsight(facts, content)` → split + enqueue + attempt flush
./debates/009-week3-audit/rounds/r001_sonnet.md:52:写入时用 `CONFIDENCE_FLOORS[tier]` (单一来源), 读取时用硬编码数字反推 tier. 若 `CONFIDENCE_FLOORS` 某一天修改 (如 `instance` 从 0.85 -> 0.87), 写入正确但读取静默错误 - 所有历史 `instance` 记录变成 `exploration`。未来 `profile_switch` 使用 `kernel(0.9)` 但若常量变了则读取也崩。
./debates/009-week3-audit/rounds/r001_sonnet.md:60:+  Object.entries(CONFIDENCE_FLOORS).map(([k, v]) => [v, k as ConfidenceTier])
./debates/009-week3-audit/rounds/r001_sonnet.md:247:2. **P2 (audit.ts:211-216)**: `CONFIDENCE_FLOORS` 反向 map 用 magic number - 目前常量冻结 (debate 007 Lock 3), 修改须走新 migration, 短期内不会出现不一致。可在 P0-2 下一次 iteration 修复, 不影响 Week 3 -> Week 4 cross-P0 集成。
./debates/017-compost-next-steps/rounds/r001_codex.md:189:./docs/ARCHITECTURE.md:100:wiki_pages.path CASCADE -> wiki_page_observe
./debates/017-compost-next-steps/rounds/r001_codex.md:210:./docs/debate5/rounds/sonnet_review.md:41:`observations` is the FK parent of `ingest_queue` (ON DELETE not specified in §1.1, defaults to RESTRICT), `derivation_run` (ON DELETE CASCADE per §1.2), `captured_item` (no ON DELETE in §1.1), and `wiki_page_observe` (ON DELETE CASCADE per §1.2). With `PRAGMA foreign_keys = ON` (required by §1.1), this DELETE will hard-fail on any row that still has an `ingest_queue` or `captured_item` child, silently under-deleting without any error surfacing to the caller. The `ReflectionReport` struct returns only `sensoryDeleted` count - there is no field for "skipped due to FK violation."
./debates/017-compost-next-steps/rounds/r001_codex.md:241:./docs/debate5/rounds/codex_review.md:14:3. **§8.4 vs §1.1/§1.2 (`lines 910-913` vs `197-202`, `214-215`, `309-313`)**. Failure mode: `reflect()` hard-deletes from `observations`, but `captured_item.observe_id`, `facts.observe_id`, and `wiki_page_observe.observe_id` all reference `observations` without `ON DELETE CASCADE`. Once a sensory observation has downstream facts or coverage rows, the DELETE will fail under `PRAGMA foreign_keys = ON`. Concrete fix: either state that `source.kind='sensory'` rows are never derivation inputs and enforce that at queue admission, or change the GC model to soft-delete observations / cascade-delete all dependent rows intentionally.
./debates/017-compost-next-steps/rounds/r001_codex.md:363:./docs/debate5/rounds/r2_sonnet_review.md:24:No `ON DELETE CASCADE`. Every other child-of-`observations` table (ingest_queue at line 204, captured_item at line 229, facts at line 245, derivation_run at line 276) received ON DELETE CASCADE via debate #5 fix pass. `wiki_page_observe` was supposed to get it too — §8.4's reflection pseudocode at line 1271 explicitly comments "derivation_run.observe_id and wiki_page_observe.observe_id also cascade (debate #3 schema)" — but the actual DDL at line 342 does NOT have CASCADE. This means `compost reflect` sensory GC will FOREIGN KEY fail the moment any sensory observation has an associated `wiki_page_observe` row, which is exactly the failure mode the v2.1 patch claimed to fix. The `skippedDueToFkViolation` counter in `ReflectionReport` (line 1241) will be non-zero in this scenario, and the DoD gate at line 1587 ("asserts... `skippedDueToFkViolation = 0`") will fail.
./debates/017-compost-next-steps/rounds/r001_codex.md:434:./docs/debate9-phase3-plan/codex-r1.md:25:`synthesizePage` executes in this order: (1) LLM generate, (2) `writeFileSync` to disk, (3) `db.run` upsert to `wiki_pages`, (4) `INSERT OR IGNORE INTO wiki_page_observe`. There is no wrapping transaction. If the process crashes between steps 2 and 3, the `.md` file exists on disk but `wiki_pages` has no record of it -- that is just orphaned disk state, recoverable on next run. The dangerous case is the reverse: step 3 succeeds but step 4 hits an FK violation on `observe_id`. The `wiki_pages` row records a synthesis timestamp that is permanently current, `findTopicsNeedingSynthesis` will skip this topic forever, and the `wiki_page_observe` links are incomplete. There is no recovery path without manual intervention.
./debates/017-compost-next-steps/rounds/r001_codex.md:466:./docs/debate3/rounds/r003_sonnet.md:33:6. `wiki_page_observe(page_path, observe_id, linked_at)` -- replaces `wiki_pages.contributing_observes TEXT`
./debates/017-compost-next-steps/rounds/r001_codex.md:518:./docs/debate3/rounds/r003_codex.md:12:- Replace `wiki_pages.contributing_observes` JSON with `wiki_page_observe(page_path, observe_id, PRIMARY KEY(page_path, observe_id))`.
./debates/017-compost-next-steps/rounds/r001_codex.md:671:./docs/debate3/synthesis.md:308:- **§1.7**: remove `contributing_observes TEXT` from `wiki_pages`; add reference to `wiki_page_observe` join
./debates/017-compost-next-steps/rounds/r001_codex.md:1061:./packages/compost-core/src/cognitive/wiki.ts:159:  // Link wiki page to source observations via wiki_page_observe
./debates/017-compost-next-steps/rounds/r001_codex.md:1643:-- L3 wiki page registry (actual markdown on disk; debate #3 replaced contributing_observes TEXT with wiki_page_observe)
./debates/017-compost-next-steps/rounds/r001_codex.md:3282:      "wiki_page_observe",
./debates/017-compost-next-steps/rounds/r001_codex.md:4300:-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
./debates/017-compost-next-steps/rounds/r001_codex.md:4377:CREATE TABLE wiki_page_observe (
./debates/017-compost-next-steps/rounds/r001_codex.md:4383:CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);
./debates/017-compost-next-steps/rounds/r001_codex.md:4654:packages/compost-core/src/schema/0002_debate3_fixes.sql:3:-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
./debates/009-week3-audit/rounds/r001_gemini.md:59:   const floor = CONFIDENCE_FLOORS[entry.confidenceTier];
./debates/009-week3-audit/rounds/r001_codex.md:23:- `wiki.ts:158-171`：`wiki_page_observe` 会残留旧 observe。
./debates/008-tier-shape-questions/rounds/r001_sonnet.md:44:理由: `EvidenceRefs` 中 `wiki_rebuild` 仅含 `input_observe_ids[]` + `input_fact_count`（`audit.ts:47-49`），`wiki.ts:130-141` 的实现也只遍历 observe_id 写入 `wiki_page_observe`；fact_ids 在 L0->L2 的 FK 链下可通过 observe_id 完整推导，额外存储 fact_ids 是冗余，且 `evidence_refs_json` 的形状已在 debate 007 Lock 1 冻结，不应扩展。
./debates/009-week3-audit/synthesis.md:92:| `wiki_page_observe` 重建只增不删 (Codex 5.2) | Codex | 每页最多 50 observes, 低增长率 |
./debates/009-week3-audit/state.json:26:    "wiki_page_observe insert-only (no delete on rebuild)"

codex
I’ve confirmed the contract text is stricter than the CLI framing. Next I’m reading the implementation and tests to see whether the system already treats `compost_fact_ids` as true fact-row identity in both idempotency and invalidation paths.
exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-engram-adapter/src/writer.ts" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
import { z } from "zod";
import { PendingWritesQueue } from "./pending-writes";
import {
  type ChunkedInsight,
  type SourceTrace,
  splitInsight,
  type SplitOptions,
} from "./splitter";
import { DEFAULT_EXPIRES_AT_DAYS } from "./constants";

// R3 mitigation — zod schema for source_trace catches field-name drift at
// the writer boundary before Engram silently accepts a malformed payload.
// Keep the shape aligned with ChunkedInsight's SourceTrace type.
export const sourceTraceSchema = z.object({
  compost_fact_ids: z.array(z.string()).min(1),
  root_insight_id: z.string().uuid(),
  chunk_index: z.number().int().nonnegative(),
  total_chunks: z.number().int().positive(),
  split_strategy: z.enum(["none", "paragraph", "sentence", "hard-cut"]),
  synthesized_at: z.string(),
  compost_wiki_path: z.string().optional(),
  derivation_run_id: z.string().optional(),
});

export function validateSourceTrace(st: unknown): SourceTrace {
  return sourceTraceSchema.parse(st) as SourceTrace;
}

export interface RememberArgs {
  origin: "compost";
  kind: "insight";
  content: string;
  project: string | null;
  scope: "project" | "global" | "meta";
  source_trace: SourceTrace;
  expires_at: string;
  confidence?: number;
  tags?: string[];
}

export interface MCPCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface EngramMcpClient {
  remember(args: RememberArgs): Promise<MCPCallResult<{ id: string }>>;
  invalidate(args: {
    fact_ids: string[];
  }): Promise<
    MCPCallResult<{ invalidated_memory_ids: string[]; count: number }>
  >;
}

export interface WriteInsightOptions extends SplitOptions {
  scope?: "project" | "global" | "meta";
  confidence?: number;
  tags?: string[];
  expiresAt?: string;
}

export interface ChunkWriteOutcome {
  chunk_index: number;
  total_chunks: number;
  status: "written" | "pending";
  memory_id?: string;
  pending_id?: number;
  error?: string;
}

export interface WriteInsightResult {
  root_insight_id: string;
  outcomes: ChunkWriteOutcome[];
  /** true if every chunk was either written or safely queued */
  ok: boolean;
}

export interface InvalidateResult {
  status: "invalidated" | "pending";
  invalidated_memory_ids?: string[];
  count?: number;
  pending_id?: number;
  error?: string;
}

export interface FlushResult {
  attempted: number;
  committed: number;
  failed: number;
}

export class EngramWriter {
  constructor(
    private readonly client: EngramMcpClient,
    private readonly queue: PendingWritesQueue,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Compute expires_at per synthesis. Caller may override (e.g. a
   * contradiction-arbitration producer wants 180d). Default 90d per
   * docs/phase-5-open-questions.md §Q2 Decision A.
   */
  computeExpiresAt(base: Date, days: number = DEFAULT_EXPIRES_AT_DAYS): string {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  }

  async writeInsight(
    opts: WriteInsightOptions
  ): Promise<WriteInsightResult> {
    const chunks = splitInsight(opts);
    if (chunks.length === 0) {
      throw new Error("splitInsight returned no chunks — empty content?");
    }
    const rootInsightId = chunks[0]!.source_trace.root_insight_id;
    const expiresAt =
      opts.expiresAt ?? this.computeExpiresAt(this.now());
    const scope = opts.scope ?? "project";

    const outcomes: ChunkWriteOutcome[] = [];

    for (const chunk of chunks) {
      // R3: validate every chunk before it leaves our boundary.
      validateSourceTrace(chunk.source_trace);

      const args = this.buildRememberArgs(
        chunk,
        opts.project,
        scope,
        expiresAt,
        opts.confidence,
        opts.tags
      );

      const result = await this.safeRemember(args);
      if (result.ok && result.data?.id) {
        outcomes.push({
          chunk_index: chunk.source_trace.chunk_index,
          total_chunks: chunk.source_trace.total_chunks,
          status: "written",
          memory_id: result.data.id,
        });
      } else {
        const pendingId = this.queue.enqueue("remember", {
          payload: args as unknown as Record<string, unknown>,
          expiresAt: new Date(expiresAt).getTime(),
        });
        outcomes.push({
          chunk_index: chunk.source_trace.chunk_index,
          total_chunks: chunk.source_trace.total_chunks,
          status: "pending",
          pending_id: pendingId,
          error: result.error,
        });
      }
    }

    return {
      root_insight_id: rootInsightId,
      outcomes,
      ok: outcomes.every(
        (o) => o.status === "written" || o.status === "pending"
      ),
    };
  }

  async invalidateFacts(factIds: string[]): Promise<InvalidateResult> {
    const args = { fact_ids: factIds };
    const result = await this.safeInvalidate(args);
    if (result.ok && result.data) {
      return {
        status: "invalidated",
        invalidated_memory_ids: result.data.invalidated_memory_ids,
        count: result.data.count,
      };
    }
    const pendingId = this.queue.enqueue("invalidate", {
      payload: args as unknown as Record<string, unknown>,
    });
    return { status: "pending", pending_id: pendingId, error: result.error };
  }

  /**
   * Retry pending writes. Commits on success, bumps attempts on failure.
   * Does not raise; caller inspects FlushResult.
   */
  async flushPending(): Promise<FlushResult> {
    const rows = this.queue.listPending();
    let committed = 0;
    let failed = 0;

    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch (e) {
        this.queue.markFailed(row.id, `invalid payload json: ${String(e)}`);
        failed++;
        continue;
      }

      const result =
        row.kind === "remember"
          ? await this.safeRemember(payload as unknown as RememberArgs)
          : await this.safeInvalidate(payload as { fact_ids: string[] });

      if (result.ok) {
        this.queue.markCommitted(row.id);
        committed++;
      } else {
        this.queue.markFailed(row.id, result.error ?? "unknown error");
        failed++;
      }
    }

    return { attempted: rows.length, committed, failed };
  }

exec
/bin/zsh -lc "sed -n '1,320p' packages/compost-core/src/cognitive/digest.ts" in /Users/zion/Repos/Zylo/Compost
exec
/bin/zsh -lc "sed -n '1,220p' docs/engram-integration-contract.md" in /Users/zion/Repos/Zylo/Compost
exec
/bin/zsh -lc "sed -n '425,520p' packages/compost-core/test/digest.test.ts" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
import type { Database } from "bun:sqlite";
import { CONFIDENCE_FLOORS } from "./audit";

/**
 * Phase 6 P0 slice 2 — Proactive push digest (Round A: selector + renderer).
 *
 * Deterministic selector over the current ledger that surfaces "noteworthy"
 * state changes in the last N days:
 *   1. new confident facts (unarchived + not superseded, >= confidence floor)
 *   2. resolved gaps (open_problems transitioned to `resolved`)
 *   3. wiki pages (re)synthesized
 *
 * Dry-run only in this slice — no Engram push. `digestInsightInput()` shapes
 * the report into SplitOptions-compatible input so Round B can wire it to
 * `EngramWriter.writeInsight()` without reshaping here.
 */

export type DigestKind = "new_fact" | "resolved_gap" | "wiki_rebuild";

export interface DigestItem {
  kind: DigestKind;
  id: string;
  headline: string;
  at: string;
  refs: {
    fact_id?: string;
    problem_id?: string;
    wiki_path?: string;
  };
}

export interface DigestWindow {
  sinceIso: string;
  untilIso: string;
}

export interface DigestReport {
  window: DigestWindow;
  generated_at: string;
  items: DigestItem[];
  new_facts: DigestItem[];
  resolved_gaps: DigestItem[];
  wiki_rebuilds: DigestItem[];
}

export interface SelectDigestOptions {
  sinceDays?: number;
  now?: Date;
  confidenceFloor?: number;
  maxItems?: number;
}

const DEFAULT_SINCE_DAYS = 7;
const DEFAULT_MAX_ITEMS = 25;

// SQLite datetime('now') stores "YYYY-MM-DD HH:MM:SS" text. Convert the ISO
// boundary we use in JS-land so lexicographic >= compares correctly.
function toSqliteDatetime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

export function buildDigest(
  db: Database,
  opts: SelectDigestOptions = {}
): DigestReport {
  const now = opts.now ?? new Date();
  const sinceDays = opts.sinceDays ?? DEFAULT_SINCE_DAYS;
  const confidenceFloor = opts.confidenceFloor ?? CONFIDENCE_FLOORS.instance;
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;

  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - sinceDays);
  const sinceIso = since.toISOString();
  const untilIso = now.toISOString();
  const sinceSqlite = toSqliteDatetime(sinceIso);

  const new_facts = selectNewFacts(db, sinceSqlite, confidenceFloor, maxItems);
  const resolved_gaps = selectResolvedGaps(db, sinceSqlite, maxItems);
  const wiki_rebuilds = selectWikiRebuilds(db, sinceSqlite, maxItems);

  const items = [...new_facts, ...resolved_gaps, ...wiki_rebuilds];

  return {
    window: { sinceIso, untilIso },
    generated_at: untilIso,
    items,
    new_facts,
    resolved_gaps,
    wiki_rebuilds,
  };
}

function selectNewFacts(
  db: Database,
  sinceSqlite: string,
  confidenceFloor: number,
  limit: number
): DigestItem[] {
  const rows = db
    .query(
      `SELECT fact_id, subject, predicate, object, confidence, importance, created_at
         FROM facts
        WHERE archived_at IS NULL
          AND superseded_by IS NULL
          AND confidence >= ?
          AND created_at >= ?
        ORDER BY importance DESC, created_at DESC
        LIMIT ?`
    )
    .all(confidenceFloor, sinceSqlite, limit) as Array<{
    fact_id: string;
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    importance: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    kind: "new_fact" as const,
    id: r.fact_id,
    headline: `${r.subject} ${r.predicate} ${r.object} (conf=${r.confidence.toFixed(2)})`,
    at: r.created_at,
    refs: { fact_id: r.fact_id },
  }));
}

function selectResolvedGaps(
  db: Database,
  sinceSqlite: string,
  limit: number
): DigestItem[] {
  const rows = db
    .query(
      `SELECT problem_id, question, ask_count, resolved_at,
              resolved_by_fact_id
         FROM open_problems
        WHERE status = 'resolved'
          AND resolved_at IS NOT NULL
          AND resolved_at >= ?
        ORDER BY ask_count DESC, resolved_at DESC
        LIMIT ?`
    )
    .all(sinceSqlite, limit) as Array<{
    problem_id: string;
    question: string;
    ask_count: number;
    resolved_at: string;
    resolved_by_fact_id: string | null;
  }>;

  return rows.map((r) => ({
    kind: "resolved_gap" as const,
    id: r.problem_id,
    headline: `asked ${r.ask_count}x "${r.question}" (resolved)`,
    at: r.resolved_at,
    refs: {
      problem_id: r.problem_id,
      ...(r.resolved_by_fact_id ? { fact_id: r.resolved_by_fact_id } : {}),
    },
  }));
}

function selectWikiRebuilds(
  db: Database,
  sinceSqlite: string,
  limit: number
): DigestItem[] {
  const rows = db
    .query(
      `SELECT path, title, last_synthesis_at
         FROM wiki_pages
        WHERE last_synthesis_at >= ?
        ORDER BY last_synthesis_at DESC
        LIMIT ?`
    )
    .all(sinceSqlite, limit) as Array<{
    path: string;
    title: string;
    last_synthesis_at: string;
  }>;

  return rows.map((r) => ({
    kind: "wiki_rebuild" as const,
    id: r.path,
    headline: `${r.title} (${r.path}) rebuilt`,
    at: r.last_synthesis_at,
    refs: { wiki_path: r.path },
  }));
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function renderDigestMarkdown(report: DigestReport): string {
  const dateRange = `${report.window.sinceIso.slice(0, 10)} to ${report.window.untilIso.slice(0, 10)}`;
  const lines: string[] = [`# Compost Digest — ${dateRange}`, ""];

  if (report.items.length === 0) {
    lines.push("(no items)");
    return lines.join("\n") + "\n";
  }

  if (report.new_facts.length > 0) {
    lines.push(`## New confident facts (${report.new_facts.length})`, "");
    for (const f of report.new_facts) lines.push(`- ${f.headline}`);
    lines.push("");
  }

  if (report.resolved_gaps.length > 0) {
    lines.push(`## Resolved gaps (${report.resolved_gaps.length})`, "");
    for (const g of report.resolved_gaps) lines.push(`- ${g.headline}`);
    lines.push("");
  }

  if (report.wiki_rebuilds.length > 0) {
    lines.push(`## Wiki pages rebuilt (${report.wiki_rebuilds.length})`, "");
    for (const w of report.wiki_rebuilds) lines.push(`- ${w.headline}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Shape report into SplitOptions-compatible input for Round B push wiring
// ---------------------------------------------------------------------------

export interface DigestInsightInput {
  compostFactIds: string[];
  content: string;
  synthesizedAt: string;
}

export function digestInsightInput(
  report: DigestReport
): DigestInsightInput | null {
  if (report.items.length === 0) return null;

  const factIds = new Set<string>();
  for (const item of [...report.new_facts, ...report.resolved_gaps]) {
    if (item.refs.fact_id) factIds.add(item.refs.fact_id);
  }
  if (factIds.size === 0) return null;

  return {
    compostFactIds: [...factIds].sort(),
    content: renderDigestMarkdown(report),
    synthesizedAt: report.generated_at,
  };
}

 succeeded in 0ms:
# Engram Integration Contract

> **Status**: Draft, 2026-04-16
> **Audience**: Engram session / Engram maintainers
> **Purpose**: This document states what **Compost expects from Engram** to support the bidirectional integration described in the Compost v3 roadmap. It does **not** prescribe Engram's implementation — the Engram session decides how to fulfill these expectations.

## Scope

This contract covers:

1. **Compost → Engram** (insight write-back): how Compost deposits synthesized knowledge into Engram
2. **Engram → Compost** (event source): how Compost subscribes to Engram's memory stream as a new ingest source
3. **Independence constraints**: what each side must do to survive the other being absent

Out of scope:

- How Engram implements event storage, kind extensions, LLM-on-write pipelines — Engram session decides
- Engram's own roadmap (v3.3 unpin + scope + schema CHECK + invariant tests continues)
- UI / CLI ergonomics on the Engram side

## Hard constraints (both sides must honor)

### HC-1 — Independence survives

- Compost must run fully without Engram installed. All Compost features (observe, query, ask, reflect, wiki synth) work standalone.
- Engram must run fully without Compost installed. All Engram features (recall, remember, proactive) work standalone.
- Either side crashing / being uninstalled must not degrade the other's availability.

### HC-2 — Engram recall path stays zero-LLM

- Engram's `recall()` path (the <50ms p95 hot path injected before every LLM call) must never invoke an LLM.
- LLM usage is allowed on Engram's **write path** (e.g. splitting a long free-form journal entry into atomic entries) but the runtime recall must remain deterministic FTS5/SQLite.

### HC-3 — Compost owns synthesis, Engram owns working memory

- Compost produces `insight` / `pattern` / `synthesis` outputs (LLM-derived).
- Engram produces `event` / `note` / `reflection` / `preference` / etc. (raw user memory).
- Compost writes back to Engram as a **new origin** (e.g. `origin=compost` or a new `kind=insight`) — Engram marks these entries as externally sourced, eligible for user review, and distinct from `origin=human` / `origin=agent`.

## Compost → Engram (insight write-back)

### Goal

When Compost synthesizes a new insight (from wiki rebuild, reflection, or Phase 7 reasoning), it pushes that insight back to Engram so that the next time Engram does a proactive recall, the insight is available with zero LLM latency.

### What Compost sends

Proposed payload (Engram may adjust schema):

```json
{
  "origin": "compost",
  "kind": "insight",
  "content": "<synthesized text, Compost must pre-split to <= 2000 chars>",
  "project": "<compost-project-name or null for cross-project insights>",
  "scope": "project | global | meta",
  "source_trace": {
    "compost_fact_ids": ["<fact_id>", "..."],
    "compost_wiki_path": "<optional wiki page path>",
    "derivation_run_id": "<compost derivation id>",
    "synthesized_at": "<ISO-8601 timestamp>"
  },
  "expires_at": "<ISO-8601 absolute timestamp, MANDATORY>",
  "confidence": 0.85,
  "tags": ["auto-generated", "compost-insight", "<optional-topic-tags>"]
}
```

> **Schema notes** (per Engram debate 019 revisions, 2026-04-16):
> - `origin="compost"` is a **schema-enforced literal** (Engram CHECK constraint:
>   `origin IN ('human', 'agent', 'compost')`). Not a code-level variant.
> - `expires_at` replaces the older `ttl_seconds` (absolute timestamp is clock-drift-safe).
> - `source_trace` and `expires_at` are **both mandatory** — no optional fields.
> - Engram schema permits `content` up to 4000 chars for other kinds, but Compost
>   must self-split to 2000 chars per insight entry (Compost side owns the splitter).

### Compost's guarantees

- `content` is always <=2000 chars — Compost splits long synthesis into multiple linked entries (parent_id linkage TBD in Phase 5 splitter design)
- `source_trace` always present — insights are always traceable back to Compost facts
- `expires_at` always computed before push (default: synthesized_at + 90 days; overridable per synthesis)
- `synthesized_at` monotonic per insight (allows Engram to detect staleness)
- Idempotency: same `(project, source_trace.compost_fact_ids)` produces the same deterministic insight ID — Compost won't spam Engram with duplicates on repeated synthesis

### What Compost expects from Engram (per Engram v3.4 Slice B Phase 2 S2, commit `ea223fa`)

- Write API: **reuses existing `mcp__engram__remember`** tool with `origin='compost'` + `kind='insight'` + `source_trace` + `expires_at`. Engram's `_map_insight_sources` auto-populates the internal `compost_insight_sources` table from `source_trace.compost_fact_ids` on insert — no separate `write_compost_insight` tool exists.
- Engram marks `origin=compost` entries distinguishably in recall output (user can filter)
- Engram implements `expires_at` semantics: hide expired entries from default recall + **30-day physical delete grace window** after expiration (debate 019 Q6)
- Engram **excludes `origin=compost` entries from the return stream by default** (prevents Compost-generated insights looping back into Compost as new source — debate 019 Q7 + prior contract HC)
- Write failure returns a clear error so Compost can log it — Compost will not retry aggressively
- **Append-only invariant**: once written, insight `content` is immutable and `updated_at = created_at`. To "update" an insight, Compost must `invalidate_compost_fact` the underlying fact IDs (soft-deletes the old entry) and then `remember` the new version — there is no edit API on Engram side.

### Invalidation semantics (Compost side)

When a Compost fact underlying an insight changes or gets superseded:

- Compost invokes **MCP tool `mcp__engram__invalidate_compost_fact`** with the affected `compost_fact_ids[]` (per debate 019 Q7 — no HTTP webhook)
- Engram reverse-looks up `compost_insight_sources` to find matching insight entries, marks them `status='obsolete'` (soft delete), physical delete after 30-day grace
- **Pinned `origin=compost` entries are also invalidated by design** — per Engram handover gotcha. If a user wants to preserve a Compost-synthesized insight across its fact-set supersession, they must convert the entry's origin via Engram's user-review path (out of scope for this contract).
- If Engram is unreachable at invalidation time, Compost queues the signal in `~/.compost/pending-engram-writes.db` with idempotent retry on next Engram availability

## Engram → Compost (event source)

### Goal

Compost treats selected Engram entries (primarily `kind=event`, `kind=note`, `kind=reflection`) as new ingest sources, feeding them through Compost's observe → extract → facts pipeline. This lets Compost synthesize across both the user's work artifacts (current source) and their personal memories (new source).

### What Engram exposes (per Engram v3.4 Slice B Phase 2 S2, commit `ea223fa`)

- **MCP tool `mcp__engram__stream_for_compost(since, kinds, project, include_compost, limit)`** — primary, streaming query. Default `limit=1000`; Compost must poll in batches.
- CLI `engram export-stream --since/--kinds/--project/--include-compost/--limit` (JSONL stdout) — same handler underneath, for scripted batch
- Each entry includes: `memory_id`, `kind`, `content`, `project`, `scope`, `created_at`, `updated_at`, `tags`, `origin`
- **Append-only**: `updated_at == created_at` always. If Engram ever adds an edit API, this contract and `_memory_to_compost_dict` on Engram side must be updated in lock-step.
- **`origin=compost` entries excluded by default** from the return set (prevents feedback loop). Use `include_compost=true` / `--include-compost` only for Compost's own audit / reconciliation paths.

### What Compost does with it

- Compost treats each eligible Engram entry as an `observation` with `source_kind=engram`
- Runs standard extraction pipeline (Python extractor + LLM fact extraction)
- Writes derived facts with `source_observation.adapter=engram`, preserving provenance back to the originating `memory_id`

### Sync model

- Pull-based (Compost polls Engram periodically; default 1h, configurable)
- Push-optional (if Engram supports webhook / MCP notification, Compost can subscribe; not required)
- Idempotency: Compost dedupes by `memory_id` — same entry ingested twice produces one observation (use `idempotency_key=engram:<memory_id>`)

### What Compost expects from Engram

- A streaming query interface filtering by kind, time, project
- Stable `memory_id` — never changes once assigned (so Compost's dedup works across session boundaries)
- Clear `updated_at` semantics — Compost re-ingests if updated (re-running extraction is cheap and idempotent)
- `origin=compost` entries are **excluded by default** from the stream (don't loop Compost-generated insights back to Compost)

## Failure modes

### Engram down, Compost running

- Compost skips Engram ingest path (zero-cost)
- Compost insights destined for Engram write-back queue locally in `~/.compost/pending-engram-writes.db`
- On Engram recovery, Compost flushes queue with idempotent retry
- Recent insights unavailable in Engram's proactive recall until flush completes — acceptable degradation

### Compost down, Engram running

- Engram's recall path is unaffected (it runs purely on local FTS5)
- New `origin=compost` entries simply stop appearing in Engram until Compost recovers
- Existing `origin=compost` entries remain valid (stale but useful) until TTL or user cleanup

### Partial failure (one side writes, other side's read blocked)

- Both sides log with a stable correlation ID (`engram_memory_id` ↔ `compost_derivation_id`)
- Reconciliation tool (Phase 5 deliverable): `compost doctor --reconcile-engram` checks for pending/dropped messages

## Questions the Engram session should answer

The Engram session has authority over these; Compost adapts to Engram's choices:

1. **Kind extension strategy**: does Engram extend existing kind enum to include `insight`, or add a separate `origin=compost` marker?
2. **Long-form write path**: does Engram implement LLM-on-write (splitting user journal into atomic entries), or require Compost / user to pre-split?
3. **Cross-project insight routing**: how does Engram tag `scope=global` insights so they surface in any project's recall?
4. **Stream API surface**: MCP tool vs CLI export vs both?
5. **User review UX**: how does the user distinguish `origin=compost` entries in recall output and approve / reject / pin them?
6. **Storage growth**: does Engram GC aged `origin=compost` entries automatically, or require explicit cleanup?

## Phase alignment

- **Compost Phase 4** (shipped 2026-04-17): PII / bench / origin_hash / examples / docs layering — no Engram integration yet
- **Compost Phase 5** (unblocked 2026-04-17): `compost-engram-adapter` package, this contract implemented. Engram side ready at `main @ ea223fa`.
- **Engram v3.3 / v3.4 Slice A** (shipped): schema work (unpin, scope, CHECK, origin=compost literal, expires_at, source_trace columns)
- **Engram v3.4 Slice B Phase 2 S2** (shipped 2026-04-17): `stream_for_compost` + `invalidate_compost_fact` MCP tools live; `remember(origin='compost')` writes auto-fill `compost_insight_sources` via `_map_insight_sources`
- **Engram Phase 3** (data-triggered): recall/proactive layering, GC daemon, engram lint compost checks, ARCHITECTURE docs

Both sides should cross-reference this document when implementing their respective halves. Changes to this contract need agreement from both sessions.

---

**Status**: Phase 5 adapter unblocked. Compost side may begin `compost-engram-adapter` package implementation. The readiness probe (`scripts/probe-engram-readiness.ts`) verifies each start-up that the three tool surfaces (`remember` accepting `origin='compost'`, `stream_for_compost`, `invalidate_compost_fact`) are live.

 succeeded in 0ms:
describe("digestInsightInput", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty report yields null", () => {
    expect(digestInsightInput(buildDigest(db))).toBeNull();
  });

  test("collects unique fact_ids from new_facts + resolved_gaps", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    insertFact(db, {
      factId: "f2",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    const g = logGap(db, "Q?");
    resolveGap(db, g.problem_id, { factId: "f1" }); // dup — should dedupe

    const out = digestInsightInput(buildDigest(db));
    expect(out).not.toBeNull();
    expect(new Set(out!.compostFactIds)).toEqual(new Set(["f1", "f2"]));
    expect(out!.content).toContain("# Compost Digest");
    expect(out!.synthesizedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("synthesizedAt uses report.generated_at", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    const report: DigestReport = buildDigest(db);
    const out = digestInsightInput(report);
    expect(out!.synthesizedAt).toBe(report.generated_at);
  });
});

codex
The code already answers most of the contract question: `digestInsightInput()` intentionally excludes wiki-only items, and the writer’s boundary/schema is built around real fact IDs, not generic provenance tokens. I’m checking idempotency and CLI semantics before I take a position.
exec
/bin/zsh -lc "sed -n '1,180p' packages/compost-cli/src/commands/digest.ts" in /Users/zion/Repos/Zylo/Compost
exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-engram-adapter/src/splitter.ts" in /Users/zion/Repos/Zylo/Compost
exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/cognitive/audit.ts" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
import { v5 as uuidv5 } from "uuid";
import {
  ADJACENT_CHUNK_SIMILARITY_CEILING,
  COMPOST_INSIGHT_UUID_NAMESPACE,
  MAX_CONTENT_CHARS,
} from "./constants";

export type SplitStrategy = "none" | "paragraph" | "sentence" | "hard-cut";

export interface SourceTrace {
  compost_fact_ids: string[];
  root_insight_id: string;
  chunk_index: number;
  total_chunks: number;
  split_strategy: SplitStrategy;
  synthesized_at: string;
  compost_wiki_path?: string;
  derivation_run_id?: string;
}

export interface ChunkedInsight {
  content: string;
  source_trace: SourceTrace;
}

export interface SplitOptions {
  project: string | null;
  compostFactIds: string[];
  content: string;
  synthesizedAt: string;
  compostWikiPath?: string;
  derivationRunId?: string;
}

/**
 * Deterministic root_insight_id from project + sorted fact_ids.
 * Re-running synthesis on the same fact set yields the same id → Engram
 * sees update, not duplicate write. See debate 020 R4.
 */
export function computeRootInsightId(
  project: string | null,
  compostFactIds: string[]
): string {
  const sorted = [...compostFactIds].sort();
  const key = (project ?? "") + "|" + sorted.join(",");
  return uuidv5(key, COMPOST_INSIGHT_UUID_NAMESPACE);
}

/**
 * Split a (possibly long) insight into <= MAX_CONTENT_CHARS chunks.
 * Prefers paragraph boundaries, falls back to sentence, then hard-cut.
 * All chunks share the same root_insight_id / fact_ids / synthesized_at.
 */
export function splitInsight(opts: SplitOptions): ChunkedInsight[] {
  const rootId = computeRootInsightId(opts.project, opts.compostFactIds);
  const sortedFactIds = [...opts.compostFactIds].sort();

  const baseTrace = (
    chunk_index: number,
    total_chunks: number,
    strategy: SplitStrategy
  ): SourceTrace => ({
    compost_fact_ids: sortedFactIds,
    root_insight_id: rootId,
    chunk_index,
    total_chunks,
    split_strategy: strategy,
    synthesized_at: opts.synthesizedAt,
    ...(opts.compostWikiPath
      ? { compost_wiki_path: opts.compostWikiPath }
      : {}),
    ...(opts.derivationRunId
      ? { derivation_run_id: opts.derivationRunId }
      : {}),
  });

  if (opts.content.length <= MAX_CONTENT_CHARS) {
    return [
      {
        content: opts.content,
        source_trace: baseTrace(0, 1, "none"),
      },
    ];
  }

  // Try paragraph split first. If any paragraph alone exceeds cap, retry
  // with sentence split. Finally fall back to hard-cut.
  let strategy: SplitStrategy = "paragraph";
  let chunks = greedyPack(
    opts.content.split(/\n\n+/).filter((p) => p.length > 0),
    MAX_CONTENT_CHARS,
    "\n\n"
  );

  if (chunks.some((c) => c.length > MAX_CONTENT_CHARS)) {
    strategy = "sentence";
    chunks = greedyPack(
      opts.content.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0),
      MAX_CONTENT_CHARS,
      " "
    );
  }

  if (chunks.some((c) => c.length > MAX_CONTENT_CHARS)) {
    strategy = "hard-cut";
    chunks = hardCut(opts.content, MAX_CONTENT_CHARS);
  }

  const total = chunks.length;
  return chunks.map((content, i) => ({
    content,
    source_trace: baseTrace(i, total, strategy),
  }));
}

function greedyPack(pieces: string[], max: number, sep: string): string[] {
  if (pieces.length === 0) return [];
  const result: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? current + sep + piece : piece;
    if (candidate.length <= max) {
      current = candidate;
    } else {
      if (current) result.push(current);
      current = piece;
    }
  }
  if (current) result.push(current);
  return result;
}

function hardCut(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) {
    out.push(s.slice(i, i + size));
  }
  return out;
}

/**
 * Jaccard similarity over lowercased whitespace tokens.
 * Used for the R6 smoke check: adjacent chunks crossing the ceiling would
 * collide with Engram's content-similarity dedupe (merge_threshold=0.75).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0)
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface AdjacentSimilarityViolation {
  pair: [number, number];
  similarity: number;
}

/**
 * Returns pairs of adjacent chunk indices whose similarity meets or exceeds
 * the Engram dedupe ceiling. Empty array = safe. Debate 020 R6 mitigation.
 */
export function checkAdjacentSimilarity(
  chunks: ChunkedInsight[]
): AdjacentSimilarityViolation[] {
  const violations: AdjacentSimilarityViolation[] = [];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const curr = chunks[i];
    if (!prev || !curr) continue;
    const sim = jaccardSimilarity(prev.content, curr.content);
    if (sim >= ADJACENT_CHUNK_SIMILARITY_CEILING) {
      violations.push({ pair: [i - 1, i], similarity: sim });
    }
  }
  return violations;
}

 succeeded in 0ms:
import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  buildDigest,
  renderDigestMarkdown,
  digestInsightInput,
} from "../../../compost-core/src/cognitive/digest";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

export function registerDigest(program: Command): void {
  program
    .command("digest")
    .description(
      "Compose a dry-run digest of noteworthy ledger state (Phase 6 P0 slice 2 Round A; no Engram push)"
    )
    .option(
      "--since-days <n>",
      "Window size in days",
      (v) => Number.parseInt(v, 10),
      7
    )
    .option(
      "--confidence-floor <f>",
      "Minimum fact confidence to include",
      (v) => Number.parseFloat(v),
      0.85
    )
    .option(
      "--max-items <n>",
      "Per-group cap on items",
      (v) => Number.parseInt(v, 10),
      25
    )
    .option("--json", "Emit JSON report instead of markdown", false)
    .option(
      "--insight-input",
      "Emit the shape that Round B will feed to EngramWriter.writeInsight (JSON)",
      false
    )
    .action((opts) => {
      const db = openDb();
      try {
        const report = buildDigest(db, {
          sinceDays: opts.sinceDays,
          confidenceFloor: opts.confidenceFloor,
          maxItems: opts.maxItems,
        });

        if (opts.insightInput) {
          const payload = digestInsightInput(report);
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          return;
        }

        process.stdout.write(renderDigestMarkdown(report));
      } finally {
        db.close();
      }
    });
}

 succeeded in 0ms:
import type { Database } from "bun:sqlite";

/**
 * Confidence floor convention from synthesis_v2 §P0-2.
 * Mirrored in migration 0010 CHECK constraint.
 */
export const CONFIDENCE_FLOORS = {
  kernel: 0.9,
  instance: 0.85,
  exploration: 0.75,
} as const;

export type ConfidenceTier = keyof typeof CONFIDENCE_FLOORS;

export type AuditKind =
  | "contradiction_arbitration"
  | "wiki_rebuild"
  | "fact_excretion"
  | "profile_switch";

export type AuditActor = "reflect" | "wiki" | "user" | "agent";

/**
 * Structured evidence payload stored as JSON in `decision_audit.evidence_refs_json`.
 *
 * Locked in debate 007 Pre-Week-3 Lock 1: each audit kind has a fixed
 * payload shape. Callers MUST pass the variant matching their `kind` so
 * `compost audit list` (and future triage consumers) can parse without
 * guessing. JSON.stringify()'d at write time, callers cast on read.
 *
 * NOTE: `profile_switch` is reserved but has no Week 3 caller (debate 007
 * synthesis §Defer). The shape is locked here for Week 5+ when
 * `compost profile switch` CLI lands.
 */
export type EvidenceRefs =
  | {
      kind: "contradiction_arbitration";
      winner_id: string;
      loser_ids: string[];
      subject: string;
      predicate: string;
    }
  | {
      kind: "wiki_rebuild";
      page_path: string;
      // 2026-04-15 debate 008 Q5 (3/4 vote): changed from input_observe_ids
      // to input_fact_ids. Wiki rebuild synthesizes from L2 facts; observe
      // provenance is one FK JOIN away (facts.observe_id) and duplicating it
      // here adds 1.5x storage without audit value.
      input_fact_ids: string[];
      input_fact_count: number;
    }
  | {
      kind: "fact_excretion";
      fact_ids: string[];
      reason: "duplicate" | "low_access" | "manual";
      count: number;
    }
  | {
      kind: "profile_switch";
      from_profile_id: string;
      to_profile_id: string;
      changed_fields: string[];
    };

/**
 * Kind -> confidence tier mapping (debate 007 Pre-Week-3 Lock 3).
 * Mirror of the docs/ARCHITECTURE.md "decision_audit confidence tier" table.
 * Callers should use `TIER_FOR_KIND[kind]` rather than picking a tier per call.
 *
 * Exception: `fact_excretion` covers both heuristic (duplicate/low_access) and
 * user-driven (manual) excretions. Callers pass the tier explicitly for
 * fact_excretion based on `evidenceRefs.reason`.
 */
export const TIER_FOR_KIND: Record<Exclude<AuditKind, "fact_excretion">, ConfidenceTier> = {
  contradiction_arbitration: "instance",
  wiki_rebuild: "instance",
  profile_switch: "kernel",
};

export interface AuditEntry {
  kind: AuditKind;
  targetId: string;
  confidenceTier: ConfidenceTier;
  confidenceActual: number;
  rationale?: string;
  evidenceRefs?: EvidenceRefs;
  decidedBy: AuditActor;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  decidedAt: string;
}

/**
 * Reflect step 2 exception (debate 007 Pre-Week-3 Lock 2): the `stale` archive
 * reason is a bulk decay-tombstone operation and per docs/ARCHITECTURE.md's
 * frozen enum, its Audit kind is explicitly `(none)`. The tombstone count is
 * carried in `ReflectionReport.semanticFactsTombstoned`, not in decision_audit.
 * Do NOT add a recordDecision call to reflect step 2.
 *
 * Week 3 audit writers: reflect step 3 (contradiction_arbitration, per
 * cluster) and wiki.ts rebuild success (wiki_rebuild, per page). That's it.
 */

/**
 * Record a high-cost decision. Throws if `confidenceActual` is below the floor
 * for the declared `confidenceTier`. Callers MUST pass a tier from the
 * `TIER_FOR_KIND` table (or pick explicitly for `fact_excretion` based on
 * reason, per docs/ARCHITECTURE.md confidence_floor table).
 *
 * `evidenceRefs` is stringified via JSON.stringify. The caller's union type
 * guarantees the payload shape matches the kind.
 */
export function recordDecision(db: Database, entry: AuditEntry): AuditRecord {
  const floor = CONFIDENCE_FLOORS[entry.confidenceTier];
  if (entry.confidenceActual < floor) {
    throw new Error(
      `audit.recordDecision: confidenceActual ${entry.confidenceActual} below ` +
      `${entry.confidenceTier} floor ${floor} for kind ${entry.kind}`
    );
  }
  // Defensive: evidence.kind should match entry.kind when provided.
  if (entry.evidenceRefs && entry.evidenceRefs.kind !== entry.kind) {
    throw new Error(
      `audit.recordDecision: evidenceRefs.kind '${entry.evidenceRefs.kind}' ` +
      `does not match entry.kind '${entry.kind}'`
    );
  }

  const evidenceJson = entry.evidenceRefs
    ? JSON.stringify(entry.evidenceRefs)
    : null;

  const result = db.run(
    "INSERT INTO decision_audit " +
      "(kind, target_id, confidence_floor, confidence_actual, rationale, evidence_refs_json, decided_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      entry.kind,
      entry.targetId,
      floor,
      entry.confidenceActual,
      entry.rationale ?? null,
      evidenceJson,
      entry.decidedBy,
    ]
  );
  const id = Number(result.lastInsertRowid);
  const row = db
    .query("SELECT decided_at FROM decision_audit WHERE id = ?")
    .get(id) as { decided_at: string };

  return { ...entry, id, decidedAt: row.decided_at };
}

/**
 * Query recent audit entries. All filters are optional; omitting them returns
 * the most recent `limit` rows (default 100). `sinceIso` is compared against
 * `decided_at` (SQLite datetime text), `targetId` is an exact match.
 */
export function listDecisions(
  db: Database,
  filter?: {
    kind?: AuditKind;
    sinceIso?: string;
    targetId?: string;
    decidedBy?: AuditActor;
    limit?: number;
  }
): AuditRecord[] {
  const kind = filter?.kind;
  const since = filter?.sinceIso;
  const targetId = filter?.targetId;
  const decidedBy = filter?.decidedBy;
  const limit = filter?.limit ?? 100;

  // Normalize `sinceIso` ("2026-04-15T12:00:00.000Z") to SQLite datetime text
  // ("2026-04-15 12:00:00") so lex comparison lines up with stored values.
  const sinceSqlite = since
    ? since.replace("T", " ").slice(0, 19)
    : null;

  const rows = db
    .query(
      "SELECT id, kind, target_id, confidence_floor, confidence_actual, rationale, " +
        "evidence_refs_json, decided_at, decided_by FROM decision_audit " +
        "WHERE (?1 IS NULL OR kind = ?1) " +
        "  AND (?2 IS NULL OR decided_at >= ?2) " +
        "  AND (?3 IS NULL OR target_id = ?3) " +
        "  AND (?4 IS NULL OR decided_by = ?4) " +
        "ORDER BY decided_at DESC, id DESC LIMIT ?5"
    )
    .all(kind ?? null, sinceSqlite, targetId ?? null, decidedBy ?? null, limit) as Array<{
    id: number;
    kind: AuditKind;
    target_id: string;
    confidence_floor: number;
    confidence_actual: number;
    rationale: string | null;
    evidence_refs_json: string | null;
    decided_at: string;
    decided_by: AuditActor;
  }>;

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    targetId: r.target_id,
    confidenceTier:
      r.confidence_floor === 0.9
        ? "kernel"
        : r.confidence_floor === 0.85
          ? "instance"
          : "exploration",
    confidenceActual: r.confidence_actual,
    rationale: r.rationale ?? undefined,
    evidenceRefs: r.evidence_refs_json
      ? (JSON.parse(r.evidence_refs_json) as EvidenceRefs)

exec
/bin/zsh -lc "sed -n '60,230p' packages/compost-engram-adapter/test/writer.test.ts" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
    writer = new EngramWriter(client, queue, () => FIXED_NOW);
  });

  afterEach(() => {
    queue.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("short insight → single remember call, written outcome", async () => {
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1", "f2"],
      content: "Short insight",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(client.rememberCalls).toHaveLength(1);
    expect(client.rememberCalls[0].origin).toBe("compost");
    expect(client.rememberCalls[0].kind).toBe("insight");
    expect(client.rememberCalls[0].expires_at).toBe("2026-07-16T00:00:00.000Z");
    expect(result.outcomes[0].status).toBe("written");
    expect(result.outcomes[0].memory_id).toBe("mem-1");
    expect(result.ok).toBe(true);
  });

  test("long insight → multiple remember calls sharing root_insight_id", async () => {
    const content = "P".repeat(900) + "\n\n" + "P".repeat(900) + "\n\n" + "P".repeat(900);
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content,
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(client.rememberCalls.length).toBeGreaterThan(1);
    const roots = new Set(
      client.rememberCalls.map((c) => c.source_trace.root_insight_id)
    );
    expect(roots.size).toBe(1);
    expect(result.outcomes.every((o) => o.status === "written")).toBe(true);
    // All chunk contents within cap
    client.rememberCalls.forEach((c) =>
      expect(c.content.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS)
    );
  });

  test("remember failure → enqueues to pending, status=pending", async () => {
    client.failRemember = true;
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "short",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(result.outcomes[0].status).toBe("pending");
    expect(result.outcomes[0].pending_id).toBeDefined();
    expect(queue.listPending()).toHaveLength(1);
  });

  test("remember thrown exception is caught → enqueued as pending", async () => {
    client.throwOnRemember = true;
    const result = await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "short",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(result.outcomes[0].status).toBe("pending");
    expect(result.outcomes[0].error).toBe("network thrown");
  });

  test("invalidateFacts success returns invalidated_memory_ids", async () => {
    const result = await writer.invalidateFacts(["f1", "f2"]);
    expect(result.status).toBe("invalidated");
    expect(result.count).toBe(2);
    expect(result.invalidated_memory_ids).toEqual(["mem-of-f1", "mem-of-f2"]);
  });

  test("invalidateFacts failure enqueues for retry", async () => {
    client.failInvalidate = true;
    const result = await writer.invalidateFacts(["f1"]);
    expect(result.status).toBe("pending");
    expect(queue.listPending()).toHaveLength(1);
    const row = queue.listPending()[0];
    expect(row.kind).toBe("invalidate");
  });

  test("flushPending retries failed rows and marks committed on success", async () => {
    // First write fails, then succeeds after toggling
    client.failRemember = true;
    await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "c",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    expect(queue.listPending()).toHaveLength(1);

    client.failRemember = false;
    const flush = await writer.flushPending();
    expect(flush.attempted).toBe(1);
    expect(flush.committed).toBe(1);
    expect(flush.failed).toBe(0);
    expect(queue.listPending()).toHaveLength(0);
  });

  test("flushPending bumps attempts on repeated failure", async () => {
    client.failRemember = true;
    await writer.writeInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "c",
      synthesizedAt: "2026-04-17T00:00:00Z",
    });
    const first = await writer.flushPending();
    expect(first.failed).toBe(1);
    const second = await writer.flushPending();
    expect(second.failed).toBe(1);
    const pending = queue.listPending();
    expect(pending[0].attempts).toBe(2);
  });

  test("validateSourceTrace rejects missing compost_fact_ids (R3)", () => {
    expect(() =>
      validateSourceTrace({
        root_insight_id: "00000000-0000-5000-8000-000000000000",
        chunk_index: 0,
        total_chunks: 1,
        split_strategy: "none",
        synthesized_at: "2026-04-17T00:00:00Z",
      })
    ).toThrow();
  });

  test("validateSourceTrace rejects typo'd field name (R3)", () => {
    expect(() =>
      validateSourceTrace({
        compost_fact_id: ["f1"], // singular typo
        root_insight_id: "00000000-0000-5000-8000-000000000000",
        chunk_index: 0,
        total_chunks: 1,
        split_strategy: "none",
        synthesized_at: "2026-04-17T00:00:00Z",
      })
    ).toThrow();
  });

  test("validateSourceTrace rejects invalid UUID on root_insight_id", () => {
    expect(() =>
      validateSourceTrace({
        compost_fact_ids: ["f1"],
        root_insight_id: "not-a-uuid",
        chunk_index: 0,
        total_chunks: 1,
        split_strategy: "none",
        synthesized_at: "2026-04-17T00:00:00Z",
      })
    ).toThrow();
  });

  test("computeExpiresAt adds 90 days by default", () => {
    const r = writer.computeExpiresAt(new Date("2026-01-01T00:00:00Z"));
    expect(r).toBe("2026-04-01T00:00:00.000Z");
  });

  test("computeExpiresAt honors override days", () => {
    const r = writer.computeExpiresAt(
      new Date("2026-01-01T00:00:00Z"),
      180
    );
    expect(r).toBe("2026-06-30T00:00:00.000Z");
  });
});

codex
There’s a plausible fourth path only if the implementation already stores fact provenance for wiki rebuilds. I’m checking whether that exists in ledger tables or only in audit JSON, because that changes whether `(d)` is a real low-risk option or a schema detour.
exec
/bin/zsh -lc "sed -n '120,220p' packages/compost-core/src/cognitive/wiki.ts" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
  // Write to disk
  const safePath = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pagePath = `${safePath}.md`;
  const fullPath = join(wikiDir, pagePath);
  mkdirSync(dirname(fullPath), { recursive: true });

  // Version snapshot: save existing content before overwrite
  const existing = db
    .query("SELECT path FROM wiki_pages WHERE path = ?")
    .get(pagePath) as { path: string } | null;

  if (existing && existsSync(fullPath)) {
    const oldContent = readFileSync(fullPath, "utf-8");
    db.run(
      `INSERT INTO wiki_page_versions (page_path, content, synthesis_model)
       VALUES (?, ?, (SELECT last_synthesis_model FROM wiki_pages WHERE path = ?))`,
      [pagePath, oldContent, pagePath]
    );
  }

  writeFileSync(fullPath, markdown, "utf-8");

  // Write to wiki_pages table. On successful rebuild, clear stale_at so
  // ask.ts stops prefixing the stale banner.
  if (existing) {
    db.run(
      `UPDATE wiki_pages SET title = ?, last_synthesis_at = datetime('now'),
         last_synthesis_model = ?, stale_at = NULL
       WHERE path = ?`,
      [topic, llm.model, pagePath]
    );
  } else {
    db.run(
      `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model)
       VALUES (?, ?, datetime('now'), ?)`,
      [pagePath, topic, llm.model]
    );
  }

  // Link wiki page to source observations via wiki_page_observe
  const observeIds = db
    .query(
      `SELECT DISTINCT f.observe_id FROM facts f
       WHERE f.subject = ? AND f.archived_at IS NULL`
    )
    .all(topic) as Array<{ observe_id: string }>;

  const insertWpo = db.prepare(
    "INSERT OR IGNORE INTO wiki_page_observe (page_path, observe_id, linked_at) VALUES (?, ?, datetime('now'))"
  );
  for (const row of observeIds) {
    insertWpo.run(pagePath, row.observe_id);
  }

  // P0-2 (Week 3): record wiki_rebuild audit row. Shape locked by debate 008
  // Q5: evidence references `input_fact_ids`, not observe_ids.
  //
  // Debate 009 Fix 3: audit is observability. At this point disk + wiki_pages
  // are already written; if recordDecision throws, surface via console.warn
  // so the daemon log captures it but don't propagate and abort synthesis.
  try {
    recordDecision(db, {
      kind: "wiki_rebuild",
      targetId: pagePath,
      confidenceTier: TIER_FOR_KIND.wiki_rebuild,
      confidenceActual: CONFIDENCE_FLOORS[TIER_FOR_KIND.wiki_rebuild],
      rationale: `${existing ? "updated" : "created"} wiki page for topic "${topic}" from ${facts.length} facts`,
      evidenceRefs: {
        kind: "wiki_rebuild",
        page_path: pagePath,
        input_fact_ids: facts.map((f) => f.fact_id),
        input_fact_count: facts.length,
      },
      decidedBy: "wiki",
    });
  } catch (auditErr) {
    console.warn(
      `wiki.synthesizePage: audit write failed for ${pagePath}:`,
      auditErr instanceof Error ? auditErr.message : String(auditErr)
    );
  }

  return { created: !existing, updated: !!existing };
}

/**
 * Run wiki synthesis for all topics needing pages.
 * Called by reflect scheduler after reflect() completes.
 *
 * `llmOrRegistry` accepts either a raw `LLMService` (test / simple caller
 * path) or a `BreakerRegistry` (production path, debate 009 Fix 1). With a
 * registry, synthesis uses `registry.get("wiki.synthesis")` so repeated
 * synthesis failures open the wiki breaker without starving `ask.answer`.
 */
export async function synthesizeWiki(
  db: Database,
  llmOrRegistry: LLMService | BreakerRegistry,
  dataDir: string
): Promise<WikiSynthesisResult> {
  const wikiDir = join(dataDir, "wiki");
  mkdirSync(wikiDir, { recursive: true });

exec
/bin/zsh -lc "sed -n '1,220p' packages/compost-core/src/schema/0002_debate3_fixes.sql" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
-- Migration 0002_debate3_fixes.sql
-- Source: compost-v2-spec.md §1.2 (from debate #3)
-- Creates: derivation_run, policies, context, fact_context, source_context, wiki_page_observe
-- Alters: ingest_queue (lease columns)

-- Replace derivations with derivation_run (fixes PK bug for policy-only reruns)
CREATE TABLE derivation_run (
  derivation_id TEXT PRIMARY KEY,                 -- uuid v7
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '',
  context_scope_id TEXT,
  extraction_profile TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','superseded')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  artifact_ref TEXT,
  supersedes_derivation_id TEXT REFERENCES derivation_run(derivation_id),
  error TEXT,
  content_hash TEXT GENERATED ALWAYS AS (
    observe_id || ':' || layer || ':' || transform_policy || ':' ||
    coalesce(model_id,'') || ':' || coalesce(context_scope_id,'') || ':' ||
    coalesce(extraction_profile,'')
  ) STORED
);

CREATE UNIQUE INDEX idx_derivation_run_active
  ON derivation_run(observe_id, layer, transform_policy, model_id,
                    coalesce(context_scope_id,''), coalesce(extraction_profile,''))
  WHERE status IN ('pending','running','succeeded');

CREATE UNIQUE INDEX idx_derivation_run_hash
  ON derivation_run(content_hash) WHERE status = 'succeeded';

-- transform_policy table (populated from TypeScript registry at daemon startup)
CREATE TABLE policies (
  policy_id TEXT PRIMARY KEY,
  supersedes TEXT REFERENCES policies(policy_id),
  effective_from TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  migration_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Context as first-class entity (flat, hierarchical-path-safe IDs)
CREATE TABLE context (
  id TEXT PRIMARY KEY,               -- e.g. 'work', 'work/project-zylo'
  display_name TEXT NOT NULL,
  isolation_level TEXT NOT NULL DEFAULT 'shared'
    CHECK(isolation_level IN ('shared','isolated')),
  trust_floor TEXT NOT NULL DEFAULT 'web'
    CHECK(trust_floor IN ('user','first_party','web')),
  freshness_ttl_sec INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

-- Replace facts.contexts TEXT[] with join table
CREATE TABLE fact_context (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK(freshness IN ('fresh','stale','expired')),
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fact_id, context_id)
);
CREATE INDEX idx_fc_context ON fact_context(context_id);

-- source context join (replaces source.contexts TEXT[])
CREATE TABLE source_context (
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, context_id)
);

-- Replace wiki_pages.contributing_observes TEXT with join
-- NOTE (v2.1): ON DELETE CASCADE on BOTH FKs. Sensory GC needs observe_id cascade;
-- wiki page deletion needs page_path cascade.
CREATE TABLE wiki_page_observe (
  page_path TEXT NOT NULL REFERENCES wiki_pages(path) ON DELETE CASCADE,
  observe_id TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_path, observe_id)
);
CREATE INDEX idx_wpo_observe ON wiki_page_observe(observe_id);

-- ingest_queue lease columns
ALTER TABLE ingest_queue ADD COLUMN lease_owner TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_token TEXT;
ALTER TABLE ingest_queue ADD COLUMN lease_expires_at TEXT;

CREATE INDEX idx_queue_claim
  ON ingest_queue(priority, enqueued_at, lease_expires_at)
  WHERE completed_at IS NULL;

CREATE UNIQUE INDEX idx_queue_active_lease
  ON ingest_queue(lease_token)
  WHERE completed_at IS NULL AND lease_token IS NOT NULL;

exec
/bin/zsh -lc "rg -n \"input_fact_ids|wiki_rebuild|decision_audit|recordDecision\\(\" packages/compost-core/src packages/compost-core/test" in /Users/zion/Repos/Zylo/Compost
 succeeded in 0ms:
packages/compost-core/test/cross-p0-integration.test.ts:23: *        -> reflect() writes decision_audit + fact_links + archived loser
packages/compost-core/test/cross-p0-integration.test.ts:93:    // P0-2: decision_audit row written.
packages/compost-core/test/cross-p0-integration.test.ts:159:    // Baseline: stale_at is NULL, wiki_rebuild audit row exists.
packages/compost-core/test/cross-p0-integration.test.ts:164:    expect(listDecisions(db, { kind: "wiki_rebuild" })).toHaveLength(1);
packages/compost-core/test/cross-p0-integration.test.ts:227:    // Two wiki_rebuild audit rows now (seed + recovery; failing call wrote none).
packages/compost-core/test/cross-p0-integration.test.ts:228:    expect(listDecisions(db, { kind: "wiki_rebuild" })).toHaveLength(2);
packages/compost-core/test/cross-p0-integration.test.ts:327:    const rebuild = listDecisions(db, { kind: "wiki_rebuild" });
packages/compost-core/test/digest.test.ts:120:    expect(r.wiki_rebuilds).toEqual([]);
packages/compost-core/test/digest.test.ts:314:describe("buildDigest — wiki_rebuilds selector", () => {
packages/compost-core/test/digest.test.ts:331:    expect(r.wiki_rebuilds).toHaveLength(1);
packages/compost-core/test/digest.test.ts:332:    expect(r.wiki_rebuilds[0]!.kind).toBe("wiki_rebuild");
packages/compost-core/test/digest.test.ts:333:    expect(r.wiki_rebuilds[0]!.refs.wiki_path).toBe("/topics/foo");
packages/compost-core/test/digest.test.ts:338:    expect(buildDigest(db).wiki_rebuilds).toHaveLength(0);
packages/compost-core/test/digest.test.ts:358:      new Set(["new_fact", "resolved_gap", "wiki_rebuild"])
packages/compost-core/test/migrator.test.ts:73:      "decision_audit",           // 0010 P0-2
packages/compost-core/test/audit.test.ts:13:describe("decision_audit (P0-2, Phase 4 Batch D)", () => {
packages/compost-core/test/audit.test.ts:30:  test("decision_audit table exists with all expected columns", () => {
packages/compost-core/test/audit.test.ts:32:      .query("PRAGMA table_info('decision_audit')")
packages/compost-core/test/audit.test.ts:61:      recordDecision(db, {
packages/compost-core/test/audit.test.ts:62:        kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:73:      recordDecision(db, {
packages/compost-core/test/audit.test.ts:74:        kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:91:    const rec = recordDecision(db, {
packages/compost-core/test/audit.test.ts:102:      .query("SELECT confidence_floor, confidence_actual, rationale FROM decision_audit WHERE id = ?")
packages/compost-core/test/audit.test.ts:114:    const rec = recordDecision(db, {
packages/compost-core/test/audit.test.ts:115:      kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:120:        kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:122:        input_fact_ids: ["f1", "f2", "f3"],
packages/compost-core/test/audit.test.ts:128:      .query("SELECT evidence_refs_json FROM decision_audit WHERE id = ?")
packages/compost-core/test/audit.test.ts:131:    expect(parsed.kind).toBe("wiki_rebuild");
packages/compost-core/test/audit.test.ts:132:    expect(parsed.input_fact_ids).toEqual(["f1", "f2", "f3"]);
packages/compost-core/test/audit.test.ts:137:    recordDecision(db, {
packages/compost-core/test/audit.test.ts:144:    recordDecision(db, {
packages/compost-core/test/audit.test.ts:145:      kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:151:    expect(listDecisions(db, { kind: "wiki_rebuild" })).toHaveLength(1);
packages/compost-core/test/audit.test.ts:157:    recordDecision(db, {
packages/compost-core/test/audit.test.ts:158:      kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:164:    recordDecision(db, {
packages/compost-core/test/audit.test.ts:165:      kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:178:      recordDecision(db, {
packages/compost-core/test/audit.test.ts:179:        kind: "wiki_rebuild",
packages/compost-core/test/audit.test.ts:190:    recordDecision(db, {
packages/compost-core/src/schema/0010_phase4_myco_integration.sql:6:-- P0-2: decision_audit — high-cost decision audit trail with confidence ladder
packages/compost-core/src/schema/0010_phase4_myco_integration.sql:37:-- P0-2: decision_audit (confidence ladder + write-path audit trail)
packages/compost-core/src/schema/0010_phase4_myco_integration.sql:43:CREATE TABLE IF NOT EXISTS decision_audit (
packages/compost-core/src/schema/0010_phase4_myco_integration.sql:47:    'wiki_rebuild',
packages/compost-core/src/schema/0010_phase4_myco_integration.sql:60:CREATE INDEX IF NOT EXISTS idx_decision_audit_kind ON decision_audit(kind, decided_at);
packages/compost-core/src/schema/0010_phase4_myco_integration.sql:61:CREATE INDEX IF NOT EXISTS idx_decision_audit_target ON decision_audit(target_id);
packages/compost-core/test/reflect-archive-reason.test.ts:314:        "SELECT kind, target_id, confidence_floor, evidence_refs_json, decided_by FROM decision_audit WHERE kind = 'contradiction_arbitration'"
packages/compost-core/test/reflect-archive-reason.test.ts:345:        "SELECT evidence_refs_json FROM decision_audit WHERE kind = 'contradiction_arbitration'"
packages/compost-core/test/reflect-archive-reason.test.ts:362:      .query("SELECT COUNT(*) AS c FROM decision_audit")
packages/compost-core/test/reflect-archive-reason.test.ts:371:      .query("SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'contradiction_arbitration'")
packages/compost-core/src/cognitive/digest.ts:18:export type DigestKind = "new_fact" | "resolved_gap" | "wiki_rebuild";
packages/compost-core/src/cognitive/digest.ts:43:  wiki_rebuilds: DigestItem[];
packages/compost-core/src/cognitive/digest.ts:79:  const wiki_rebuilds = selectWikiRebuilds(db, sinceSqlite, maxItems);
packages/compost-core/src/cognitive/digest.ts:81:  const items = [...new_facts, ...resolved_gaps, ...wiki_rebuilds];
packages/compost-core/src/cognitive/digest.ts:89:    wiki_rebuilds,
packages/compost-core/src/cognitive/digest.ts:185:    kind: "wiki_rebuild" as const,
packages/compost-core/src/cognitive/digest.ts:218:  if (report.wiki_rebuilds.length > 0) {
packages/compost-core/src/cognitive/digest.ts:219:    lines.push(`## Wiki pages rebuilt (${report.wiki_rebuilds.length})`, "");
packages/compost-core/src/cognitive/digest.ts:220:    for (const w of report.wiki_rebuilds) lines.push(`- ${w.headline}`);
packages/compost-core/src/cognitive/audit.ts:17:  | "wiki_rebuild"
packages/compost-core/src/cognitive/audit.ts:24: * Structured evidence payload stored as JSON in `decision_audit.evidence_refs_json`.
packages/compost-core/src/cognitive/audit.ts:44:      kind: "wiki_rebuild";
packages/compost-core/src/cognitive/audit.ts:47:      // to input_fact_ids. Wiki rebuild synthesizes from L2 facts; observe
packages/compost-core/src/cognitive/audit.ts:50:      input_fact_ids: string[];
packages/compost-core/src/cognitive/audit.ts:68: * Mirror of the docs/ARCHITECTURE.md "decision_audit confidence tier" table.
packages/compost-core/src/cognitive/audit.ts:77:  wiki_rebuild: "instance",
packages/compost-core/src/cognitive/audit.ts:100: * carried in `ReflectionReport.semanticFactsTombstoned`, not in decision_audit.
packages/compost-core/src/cognitive/audit.ts:104: * cluster) and wiki.ts rebuild success (wiki_rebuild, per page). That's it.
packages/compost-core/src/cognitive/audit.ts:116:export function recordDecision(db: Database, entry: AuditEntry): AuditRecord {
packages/compost-core/src/cognitive/audit.ts:137:    "INSERT INTO decision_audit " +
packages/compost-core/src/cognitive/audit.ts:152:    .query("SELECT decided_at FROM decision_audit WHERE id = ?")
packages/compost-core/src/cognitive/audit.ts:188:        "evidence_refs_json, decided_at, decided_by FROM decision_audit " +
packages/compost-core/src/cognitive/wiki.ts:101:    // decision_audit row for a non-rebuild; this is not a real decision.
packages/compost-core/src/cognitive/wiki.ts:174:  // P0-2 (Week 3): record wiki_rebuild audit row. Shape locked by debate 008
packages/compost-core/src/cognitive/wiki.ts:175:  // Q5: evidence references `input_fact_ids`, not observe_ids.
packages/compost-core/src/cognitive/wiki.ts:181:    recordDecision(db, {
packages/compost-core/src/cognitive/wiki.ts:182:      kind: "wiki_rebuild",
packages/compost-core/src/cognitive/wiki.ts:184:      confidenceTier: TIER_FOR_KIND.wiki_rebuild,
packages/compost-core/src/cognitive/wiki.ts:185:      confidenceActual: CONFIDENCE_FLOORS[TIER_FOR_KIND.wiki_rebuild],
packages/compost-core/src/cognitive/wiki.ts:188:        kind: "wiki_rebuild",
packages/compost-core/src/cognitive/wiki.ts:190:        input_fact_ids: facts.map((f) => f.fact_id),
packages/compost-core/src/cognitive/reflect.ts:274:              recordDecision(db, {

codex
Pick `(a)`, but implement it deliberately: make digest default to the exploration tier `0.75`, keep `--confidence-floor` as an override, and document that digest selection is not the same semantic threshold as arbitration.

`(b)` is not excusable. In this codebase, `compost_fact_ids` is not “generic provenance”; it is treated as real fact-row identity. `digestInsightInput()` in [`packages/compost-core/src/cognitive/digest.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/digest.ts) explicitly returns `null` when no real fact IDs are present. `validateSourceTrace()` in [`packages/compost-engram-adapter/src/writer.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-engram-adapter/src/writer.ts) enforces `min(1)`, and `computeRootInsightId()` in [`splitter.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-engram-adapter/src/splitter.ts) derives idempotency from sorted `compostFactIds`. Invalidation also routes through `invalidateFacts(factIds)`. A fake `sha1("wiki:"+path)` would satisfy the zod shape while breaking the actual contract: trace, idempotency, and invalidation would all be semantically wrong.

On `(a)`: yes, keep `--confidence-floor`. The help text should say digest is a “noteworthy changes” filter, not the arbitration floor. Also, this is not actually a 1-line change in the current implementation. The CLI hardcodes `0.85` in [`packages/compost-cli/src/commands/digest.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-cli/src/commands/digest.ts), and `buildDigest()` falls back to `CONFIDENCE_FLOORS.instance` in core. If you want the real default to change for both CLI and programmatic callers, change both.

`(d)` exists, but not via `wiki_page_observe`; that table only gives `observe_id`. The real future-safe path is `decision_audit.evidence_refs_json`: wiki rebuilds already record `input_fact_ids` in [`packages/compost-core/src/cognitive/wiki.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/wiki.ts). That is a valid later refinement, but it adds a second provenance path and more query complexity.

For the first S6-2 live dogfood, `(a)` minimizes failure-attribution complexity while still exercising the real write path. If push fails, the blame stays in transport/Engram, not in a fake provenance shim.
tokens used
41,654
Pick `(a)`, but implement it deliberately: make digest default to the exploration tier `0.75`, keep `--confidence-floor` as an override, and document that digest selection is not the same semantic threshold as arbitration.

`(b)` is not excusable. In this codebase, `compost_fact_ids` is not “generic provenance”; it is treated as real fact-row identity. `digestInsightInput()` in [`packages/compost-core/src/cognitive/digest.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/digest.ts) explicitly returns `null` when no real fact IDs are present. `validateSourceTrace()` in [`packages/compost-engram-adapter/src/writer.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-engram-adapter/src/writer.ts) enforces `min(1)`, and `computeRootInsightId()` in [`splitter.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-engram-adapter/src/splitter.ts) derives idempotency from sorted `compostFactIds`. Invalidation also routes through `invalidateFacts(factIds)`. A fake `sha1("wiki:"+path)` would satisfy the zod shape while breaking the actual contract: trace, idempotency, and invalidation would all be semantically wrong.

On `(a)`: yes, keep `--confidence-floor`. The help text should say digest is a “noteworthy changes” filter, not the arbitration floor. Also, this is not actually a 1-line change in the current implementation. The CLI hardcodes `0.85` in [`packages/compost-cli/src/commands/digest.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-cli/src/commands/digest.ts), and `buildDigest()` falls back to `CONFIDENCE_FLOORS.instance` in core. If you want the real default to change for both CLI and programmatic callers, change both.

`(d)` exists, but not via `wiki_page_observe`; that table only gives `observe_id`. The real future-safe path is `decision_audit.evidence_refs_json`: wiki rebuilds already record `input_fact_ids` in [`packages/compost-core/src/cognitive/wiki.ts`](/Users/zion/Repos/Zylo/Compost/packages/compost-core/src/cognitive/wiki.ts). That is a valid later refinement, but it adds a second provenance path and more query complexity.

For the first S6-2 live dogfood, `(a)` minimizes failure-attribution complexity while still exercising the real write path. If push fails, the blame stays in transport/Engram, not in a fake provenance shim.
