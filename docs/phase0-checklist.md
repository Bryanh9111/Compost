# Phase 0 Implementation Checklist

Source of truth: [phase0-spec.md](./phase0-spec.md). This file orders the build.

**Execution model**: each step is one commit (or contiguous commit group). `Fixtures first` means write tests/fixtures, let them fail, then implement. `Verify` is the gate to the next step — do not proceed red.

Runtime decision (§11 #3): **keep hybrid Python/Node**.

---

## Step 0. Spec gaps to close before Step 1

1. **CLI binary**: §0 names `compost` binary but layout only shows `compost-daemon`. Decision: add `packages/compost-cli/` with bin `compost` exposing subcommands `compost daemon` (launches the daemon), `compost add`, `compost doctor`. The `compost-daemon` package stays as the library holding MCP server + scheduler; `compost daemon` is a thin launcher.
2. **LanceDB scope in Phase 0**: embeddings are Phase 1, but `compost doctor --reconcile` needs row counts. Phase 0 writes chunk rows with null-vector placeholder (LanceDB supports nullable vectors via schema). Reconcile compares `(observe_id, chunk_id)` counts only. Flag in `docs/architecture.md`.

Both are checklist-local decisions, not spec changes. If either is wrong, stop and amend `phase0-spec.md` before proceeding.

---

## Phase A — Foundation (Node/Bun)

### Step 1. Workspace root
- **Deliverable**: root `package.json` (bun workspaces: `packages/*`), `tsconfig.base.json` (strict, ESNext), `.gitignore` additions (`node_modules/`, `*.db`, `.compost-local/`)
- **Verify**: `bun install` exits 0
- **Depends on**: nothing

### Step 2. compost-core skeleton
- **Deliverable**: `packages/compost-core/{package.json, tsconfig.json, src/index.ts}`
- **Verify**: `bun run --cwd packages/compost-core tsc --noEmit` exits 0
- **Depends on**: Step 1

### Step 3. L0 schema + migration runner
- **Fixtures first**: `test/schema/migrate.test.ts` — apply to ephemeral sqlite, assert all §1 tables + indexes exist
- **Deliverable**: `src/schema/0001_init.sql` (verbatim §1), `src/schema/apply.ts` (reads numbered SQL files in order, single transaction)
- **Verify**: `bun test test/schema/` green
- **Depends on**: Step 2

### Step 4. transform_policy registry
- **Fixtures first**: `test/policies/registry.test.ts` — asserts `tp-2026-04` exists with all required fields from §2; `supersedes === null`
- **Deliverable**: `src/policies/registry.ts` (verbatim §2 shape)
- **Verify**: `bun test test/policies/` green
- **Depends on**: Step 2

### Step 5. is_noteworthy + 6 fixtures
- **Fixtures first**: `test/ledger/fixtures/{identical,whitespace-only,comma-fix,new-paragraph,complete-rewrite,first-seen}.json`, `test/ledger/noteworthy.test.ts` parameterized over all 6
- **Deliverable**: `src/ledger/noteworthy.ts` (raw hash + normalized hash + MinHash jaccard gates per §7), `src/ledger/minhash.ts` (5-shingle + minhash)
- **Verify**: all 6 fixtures green. **DoD ✓**: `is_noteworthy()` passes 6 fixtures
- **Depends on**: Steps 2, 4

---

## Phase B — Python extraction runtime

### Step 6. Ingest JSON Schema
- **Deliverable**: `docs/compost-ingest-output.schema.json` (JSON Schema Draft 2020 matching §4.3)
- **Verify**: schema compiles (`ajv` or `python -c 'import jsonschema; jsonschema.Draft202012Validator.check_schema(...)'`)
- **Depends on**: nothing

### Step 7. compost_ingest package
- **Deliverable**:
  - `packages/compost-ingest/pyproject.toml` (uv; pins: pydantic, jsonschema, docling, unstructured, pytest)
  - `compost_ingest/{__init__.py, schema.py, cli.py, extractors/markdown.py}`
- **Verify**: `uv sync && echo '{...minimal valid input...}' | uv run python -m compost_ingest extract` returns JSON validating against Step 6 schema
- **Depends on**: Step 6

### Step 8. Schema contract test
- **Fixtures first**: `tests/fixtures/{basic,heading-tree,code-block}.json` (3+ markdown inputs)
- **Deliverable**: `tests/test_schema_contract.py` (verbatim §4.4), `uv.lock` committed
- **Verify**: `uv run pytest tests/test_schema_contract.py -q` green. **DoD ✓**: schema contract test on 3+ fixtures
- **Depends on**: Steps 6, 7

---

## Phase C — Adapter SDK (Node)

### Step 9. Outbox
- **Fixtures first**: `test/outbox.test.ts` — append → markSent → markAcked → listPending filters acked; reopen DB, pending rows survive
- **Deliverable**: `packages/compost-adapter-sdk/package.json`, `src/outbox.ts` (verbatim §3)
- **Verify**: test green
- **Depends on**: Step 1

### Step 10. MCP stdio client + HostAdapter base
- **Deliverable**: `src/mcp-client.ts` (spawn process, JSON-RPC over stdio, `onReconnect` hook), `src/adapter.ts` (verbatim §3 `HostAdapter`), `src/index.ts`
- **Verify**: unit-level: HostAdapter instantiates and outbox replay is callable without a daemon
- **Depends on**: Step 9

---

## Phase D — Core API + daemon

### Step 11. Core observe/query
- **Fixtures first**:
  - `test/api/observe.test.ts` — writes to `observations` + `ingest_queue`, dedupes on `(adapter, source_id, idempotency_key)`, returns `duplicate_of` on content_hash collision
  - `test/api/query.test.ts` — empty DB returns `[]` with correct schema
- **Deliverable**: `src/ledger/observations.ts`, `src/queue/enqueue.ts`, `src/query/index.ts` (Phase 0 stub: SELECT from facts returning `[]`), `src/api.ts` (`createCompost` per §5)
- **Verify**: `bun test test/api/` green
- **Depends on**: Steps 3, 4, 5

### Step 12. LanceDB wrapper
- **Fixtures first**: `test/storage/lance.test.ts` — two concurrent inserts serialize through AsyncMutex, both land; file lock released after close
- **Deliverable**: `src/storage/lance.ts` (single-writer `AsyncMutex` + file-lock, table open with nullable vector column, insert chunk rows keyed by `(observe_id, chunk_id)`)
- **Verify**: test green. Guardrail: single-writer mutex (from §9)
- **Depends on**: Step 11

### Step 13. Ingest pipeline (Node → Python subprocess)
- **Fixtures first**: integration test `test/queue/run.test.ts` — enqueue observe on small markdown, drain queue, assert LanceDB has chunk rows
- **Deliverable**: `src/queue/run.ts` — dequeue → `spawn('python', ['-m', 'compost_ingest', 'extract'])` → parse JSON → write chunks via Step 12 wrapper → mark derivation row
- **Verify**: integration test green
- **Depends on**: Steps 7, 8, 11, 12

### Step 14. compost-daemon
- **Deliverable**: `packages/compost-daemon/{package.json, src/main.ts, src/mcp-server.ts, src/scheduler.ts}`. MCP server exposes `compost.observe` (notification), `compost.query` (tool), `compost.reflect` (no-op stub). Scheduler is empty timer hook.
- **Verify**: spawn daemon, send `compost.query` over stdio, receive `[]` with correct envelope. **DoD ✓**: daemon starts + applies migrations + serves stdio MCP
- **Depends on**: Step 11

### Step 15. compost-embedded
- **Deliverable**: `packages/compost-embedded/{package.json, src/index.ts}` — re-exports `createCompost` from compost-core
- **Verify**: import from a throwaway script returns working Compost instance
- **Depends on**: Step 11

---

## Phase E — First adapter, CLI, doctor

### Step 16. compost-adapter-claude-code
- **Deliverable**: `packages/compost-adapter-claude-code/{package.json, src/index.ts}` — subclass HostAdapter, Phase 0 minimum: on `start()` emit one test observe
- **Verify (1)**: adapter connects to daemon, test observe lands in L0, ack recorded in outbox. **DoD ✓**: adapter connects + ack returns
- **Verify (2, durability)**: kill daemon mid-send → restart daemon → restart adapter → observe appears in L0 exactly once. **DoD ✓**: outbox survives daemon restart
- **Depends on**: Steps 10, 14

### Step 17. compost CLI + `add`
- **Deliverable**: `packages/compost-cli/{package.json (bin: compost), src/main.ts, src/commands/add.ts, src/commands/daemon.ts}`. `add.ts` reads file, constructs `ObserveEvent`, calls embedded core (no MCP hop).
- **Verify**: `compost add test/fixtures/sample.md` → row in `observations`, `ingest_queue` drained, chunk rows in LanceDB. **DoD ✓**: `compost add <file>` writes L0 + enqueues + runs extraction + stores chunks
- **Depends on**: Steps 13, 15

### Step 18. `compost doctor --reconcile`
- **Deliverable**: `packages/compost-cli/src/commands/doctor.ts` — compares `SELECT COUNT(*) FROM observations o JOIN derivations d USING(observe_id) WHERE d.layer='L1'` against LanceDB row count; Phase 0 reports delta only, no auto-rebuild. `scripts/compost-doctor.ts` is a shim calling the CLI command.
- **Verify**: `compost doctor --reconcile` prints `L0: N observations, L1: M chunks, delta: D`. **DoD ✓**: doctor runs + reports delta
- **Depends on**: Step 17

### Step 19. install.sh + portability guard
- **Deliverable**: `scripts/install.sh` — verbatim §8 plus a guard that errors out if `$HOME/.compost` resolves inside Dropbox / iCloud / OneDrive paths. `$REPOS`/`$HOME` expansion validated on `compost relearn` (future; Phase 0 only needs the install check).
- **Verify**: fresh macOS clone + `./scripts/install.sh` runs clean end-to-end. **DoD ✓**: install.sh runs clean on fresh checkout
- **Depends on**: all prior Phase D/E steps

---

## Phase F — Docs (parallelizable after Step 1)

### Step 20. docs/coverage-slo.md
- **Deliverable**: Auditable Coverage spec — SLO formula, freshness windows, how `expected_item` + `captured_item` feed it
- **Verify**: `rg -w 'complete|completeness' docs/coverage-slo.md` matches zero lines that imply guarantee. **DoD ✓**: coverage-slo.md exists, no "complete" guarantee

### Step 21. docs/transform-policy.md
- **Deliverable**: versioning rule per §2, immutability, rebuild implications, `migration_notes` guidance
- **Verify**: file exists, references `tp-YYYY-MM[-NN]` format and `supersedes` field. **DoD ✓**

### Step 22. docs/portability.md
- **Deliverable**: local-disk-only rule, Dropbox/iCloud incompatibility rationale, path expansion rules for `$REPOS`/`$HOME`
- **Verify**: file exists, install.sh Step 19 references it. **DoD ✓**

### Step 23. docs/architecture.md
- **Deliverable**: trimmed from `docs/debate/synthesis.md`, Phase 0 reality only, marks all Phase 1+ items as deferred; includes the CLI/LanceDB clarifications from Step 0
- **Verify**: file exists, linked from a root README (or from `phase0-spec.md`)

---

## Final gate: §10 DoD replay

Run every item in `phase0-spec.md` §10 manually. Expected passes, tagged with the step that closed them:

**Functional:**
- [ ] install.sh clean on fresh checkout (Step 19)
- [ ] compost-daemon starts + MCP stdio (Step 14)
- [ ] adapter connects + ack (Step 16)
- [ ] outbox survives daemon restart (Step 16)
- [ ] `compost.query` returns empty with correct schema (Step 14)
- [ ] `compost add <file>` full pipeline (Step 17)
- [ ] `compost doctor --reconcile` runs (Step 18)

**Non-functional:**
- [ ] `tp-2026-04` registry compiles (Step 4)
- [ ] `is_noteworthy()` 6-fixture pass (Step 5)
- [ ] schema contract test on 3+ fixtures (Step 8)
- [ ] `uv.lock` committed (Step 8)
- [ ] `bun.lockb` committed (Step 1)
- [ ] `docs/coverage-slo.md` no "complete" guarantee (Step 20)
- [ ] `docs/transform-policy.md` present (Step 21)
- [ ] `docs/portability.md` present (Step 22)

**Then:**
- [ ] `git status` clean
- [ ] `rm -rf node_modules packages/*/node_modules && ./scripts/install.sh` runs clean

---

## Budget notes

- 23 steps, most are <1hr each. Phases A+B+C are parallel-safe after Step 2.
- TDD discipline enforced at Steps 3, 4, 5, 8, 9, 11, 12, 13 (the ones with real logic).
- Stop-the-line triggers: any step whose `Verify` fails twice → do not switch tactics, read the error and diagnose.
- Any spec gap discovered mid-step → stop, amend `phase0-spec.md` first, resume.
