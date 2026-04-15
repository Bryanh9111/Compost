# Round 1 - Sonnet 4.6 Audit: Week 3 Plan (P0-2 + P0-6)

**Participant**: Sonnet 4.6 (Scope/KISS/Honest-Estimation perspective)
**Date**: 2026-04-15
**Branch**: feat/phase4-batch-d-myco-integration

---

## 1. P0-2 Scope Gaps

### Gap 1: `stale` tombstone path does NOT write a `decision_audit` row - and plan says nothing about it

`reflect.ts` step 2 (`semanticTombstone`) batch-updates up to thousands of facts in one `db.transaction()` with `archive_reason = 'stale'`. The ARCHITECTURE.md contract explicitly notes: "Bulk operation, no audit row per fact." The Week 3 plan must make this choice explicit rather than implicit. If the plan says "P0-2 wires `recordDecision()` into reflect step 2", that is wrong - one audit row per decayed fact is unacceptable at scale. The plan needs to explicitly declare that step 2 writes **zero** `decision_audit` rows (only `contradicted` and `wiki_rebuild` get rows). This is a scope definition gap, not a code gap, but it will cause confusion when a reviewer checks step 2 and finds no `recordDecision()` call.

### Gap 2: `evidence_refs_json` population is not addressed

`AuditEntry.evidenceRefs?: string[]` exists in `audit.ts:29`. The `recordDecision()` stub stores this as `evidence_refs_json` in the `decision_audit` table. For `contradiction_arbitration` the natural evidence refs are `[winner_fact_id, loser_fact_id]`. For `wiki_rebuild` they are the observe_ids that triggered the rebuild. The plan mentions wiring `recordDecision()` into reflect step 3 and wiki, but does not specify what each call site populates in `evidenceRefs`. Without a concrete spec per site, implementors will either leave it null (useless audit trail) or invent inconsistent formats. This is a P0-2 deliverable gap.

### Gap 3: `profile_switch` audit kind - Week 3 scope is ambiguous

`AuditKind` includes `profile_switch` (`audit.ts:19`), but no profile-switching code exists anywhere in the codebase today. The plan does not clarify whether `profile_switch` is in or out of Week 3. It should be explicitly declared out-of-scope (no call site, reserved enum value) to prevent scope creep.

### Gap 4 (minor): `listDecisions()` stub - CLI wiring requires this to be non-stub

The plan mentions "wiring audit to CLI". `listDecisions()` returns `[]` unconditionally (`audit.ts:57-61`). Both `recordDecision` and `listDecisions` must be implemented. The plan should call out both, not just the write side.

---

## 2. P0-6 Scope Gaps

### Gap 1: No concrete circuit breaker thresholds defined

The plan mentions "CircuitBreakerLLM decorator" without specifying:
- **failure threshold** to trip (e.g., 5 consecutive failures? 3 in 60s window?)
- **open duration** before half-open probe (e.g., 30s? 60s? 5m?)
- **probe count** in half-open state (1 success to close? or N-of-M?)

`OllamaLLMService` has `DEFAULT_TIMEOUT_MS = 120_000` (2 min). With a 2-minute timeout and no circuit breaker, 5 queued calls could block 10 minutes. The threshold and window must be chosen with this timeout in mind. Without concrete numbers the Week 3 implementation will produce an untestable decorator - you cannot write a deterministic test for "trip after N failures" without knowing N.

**Recommended baseline**: trip after 3 failures within a 60s window; open for 30s; 1 successful probe to close.

### Gap 2: One global breaker vs. per-site breaker - not decided

The 4 TS call sites (`wiki.ts:86`, `ask.ts:35`, `ask.ts:152`, `mcp-server.ts:201`) all use `OllamaLLMService` which hits the same Ollama process. If the breaker is **global** (wrapping the `LLMService` instance), a timeout in `wiki.ts` trips the breaker and immediately short-circuits an unrelated `ask.ts:35` expansion call. If per-site, the `mcp-server.ts:201` site instantiates a fresh `OllamaLLMService()` inline on every MCP call - wrapping it requires refactoring that constructor call. Neither is trivially correct. The plan must decide before implementation starts.

### Gap 3: Self-Consumption injection point is underspecified

ARCHITECTURE.md §"Self-Consumption guard" says the extractor must refuse to re-ingest wiki content. The injection point is in the Python layer (`compost-ingest`) or in the TS drain path. Looking at the actual code:

- `ingest.ts` and `web-ingest.ts` call `appendToOutbox()` then `drainOne()` - there is no source-kind check before drain
- The guard could go in `drainOne()` (`outbox.ts:83`) by checking `source_kind == 'wiki-rebuild'`, or in `ingestFile()` by checking `absPath.includes('/wiki/')` before appending

Neither location is identified in the plan. Without a specific function + file + check, this sub-requirement will either be skipped or implemented inconsistently across the two pipeline files.

### Gap 4: `MockLLMService` scope - unit test only or also integration?

The plan lists `MockLLMService` as a Week 3 deliverable. This is needed for circuit breaker unit tests. However `mcp-server.ts:201` hardcodes `new OllamaLLMService()` - integration tests for `compost.ask` MCP tool cannot inject a mock without refactoring the MCP handler. If `MockLLMService` is only for unit tests, say so. If it requires making `OllamaLLMService` injectable in the MCP server, that is additional scope.

---

## 3. Unforeseen Failures

### Failure 1: `recordDecision()` inside `reflect()` transaction boundary

`reflect.ts` step 3 runs inside `resolveTx = db.transaction(...)`. If `recordDecision()` also opens a transaction (the stub throws before we know), nesting SQLite transactions in Bun requires `SAVEPOINT` semantics. `bun:sqlite`'s `.transaction()` uses `BEGIN IMMEDIATE` by default and does NOT support nested `BEGIN` calls. If `recordDecision()` internally calls `db.run("BEGIN...")` or `db.transaction(...)`, it will throw `"cannot start a transaction within a transaction"`. The implementation must use `db.run("INSERT INTO decision_audit ...")` directly inside the existing transaction, not a nested `db.transaction()` call.

### Failure 2: Circuit breaker state is per-process-instance, not persistent

If `CircuitBreakerLLM` stores state in memory (open/closed/half-open + failure count + timestamp), the daemon's 6-hour reflect scheduler or a restart will reset breaker state. A tripped breaker after daemon restart will immediately retry Ollama even if it was just offline. This is acceptable only if documented. The risk is: a degraded Ollama node causes repeated daemon restarts (the daemon crashes on the ask tool, operator restarts it), and each restart resets the breaker - no actual protection accumulates.

### Failure 3: Self-Consumption guard creates a `source_kind` that doesn't exist in `OutboxEvent` union type

`outbox.ts:16` defines `source_kind` as a union of `"local-file" | "local-dir" | "web" | "claude-code" | "host-adapter" | "sensory"`. Adding `"wiki-rebuild"` as a guard check requires adding it to the union type AND the `compost.observe` MCP tool's Zod schema. If only the check is added without the type update, TypeScript will reject the comparison as always-false. Conversely, if the guard is implemented as a path-check on `source_uri` instead, it bypasses the type issue but misses programmatic wiki-rebuild calls that don't produce a file path.

---

## 4. Estimation Verdict

### P0-2 (decision_audit wiring)

**S** (small, 1-2 days) - IF the scope is limited to:
1. Implement `recordDecision()` INSERT + confidence floor check
2. Implement `listDecisions()` SELECT
3. Wire one call in `reflect.ts` step 3 (contradiction_arbitration)
4. Wire one call in `wiki.ts` (wiki_rebuild)
5. Wire `compost audit list` CLI command

There are only 2 write sites and 2 read sites. The schema (migration 0010) is already done. The stub is 5 lines. This is genuinely small if the scope is contained.

**Risk escalation to M**: if `profile_switch` is included, or if `evidence_refs_json` requires cross-table joins to populate correctly, or if audit queries need indexes not in migration 0010.

### P0-6 (circuit breaker + self-consumption + mock)

**M** (medium, 3-4 days) - breakdown:
- CircuitBreakerLLM decorator class + state machine: 1 day
- Wiring to 4 call sites (requires MCP server refactor for injectability): 1 day
- Per-site fallback logic (wiki stale_at, ask banner, expansion skip): 1 day
- Self-Consumption guard (injection point + type change + test): 0.5 day
- MockLLMService + test coverage: 0.5 day

This is NOT small. The mcp-server.ts hardcoded `new OllamaLLMService()` alone requires a refactor touching the daemon entry point.

### Week 3 total: **5-6 days** for both P0-2 + P0-6, assuming no schema gaps and no `profile_switch`.

---

## 5. Week 3 Verdict: Conditional Go

Three preconditions before implementation starts:

1. **Breaker parameters locked**: document threshold (N failures), window (seconds), open duration, probe count in a code comment or in this debate before any CircuitBreakerLLM code is written. No implementation without agreed numbers.

2. **Self-Consumption injection point decided**: specify exactly which function in which file adds the guard check, and whether `"wiki-rebuild"` joins the `source_kind` union type or the guard is a URI-pattern check. One approach only.

3. **P0-2 `stale` path declared explicitly out-of-scope for `recordDecision()`**: update the plan to state that step 2 (decay tombstone) writes zero `decision_audit` rows, to prevent an implementor adding per-fact audit rows for a bulk operation that could affect 10,000 facts at once.

---

## 6. One-Sentence Warning

P0-6 touches 4 call sites across 2 packages, one of which (`mcp-server.ts`) hardcodes `new OllamaLLMService()` inline, making the circuit breaker unapproachable without a refactor that the plan has not acknowledged - budget accordingly or the breaker will cover 3 of 4 sites and the team will ship a false sense of protection.

---

DONE_R1_SONNET_007
