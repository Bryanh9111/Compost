# Debate 6 — Outbox Topology: Pragmatic Implementer Position

**Model**: Claude Sonnet 4.6
**Role**: 2am-debug voice

---

## 1. Pick

**Option A — Per-adapter outbox files + ATTACH**

---

## 2. Rationale

The spec already committed to per-adapter outbox isolation in Debate 1 and spent two subsequent debates refining the crash semantics around it. The Codex reviewer's HOLD verdict was not "the design is wrong" — it was "the design is correct but the transaction boundary is unspecified." ATTACH closes that gap without reversing the architecture. Option B looks simpler on paper but introduces a single write-lock bottleneck at exactly the wrong layer: the hook shim fires on every `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop` event. Under heavy Claude Code usage that is 10-30 SQLite writes per minute against the same file that the drain loop, `compost add`, and potentially a second adapter are also hitting. WAL mode serializes writes — you cannot escape that with partitioning columns. SQLite was designed for concurrent readers but serial writers. One file for all of them means one stalled write stalls everything. The per-adapter isolation is not an aesthetic preference; it is the only way the hook shim's `BEGIN IMMEDIATE` does not wait on an unrelated adapter's drain loop.

ATTACH is a documented, production-tested SQLite feature. SQLite's WAL mode atomicity guarantee across attached databases is explicit in the SQLite documentation and in the better-sqlite3 implementation. It is not a hack; it is the designed cross-file transaction path. The actual work to implement it is: daemon opens ledger.db as main, attaches each known adapter outbox by name at startup or on first drain, uses `<alias>.<table>` references in the drain SQL. That is three lines of initialization code and a find/replace on the drain SQL template. The Codex reviewer asked for the ATTACH lifecycle to be documented — that is a spec edit, not a rearchitecture.

The 10-DB ATTACH limit is a real constraint. At default compile options you hit the wall at 10 adapters simultaneously attached. But: Phase 0 ships exactly one adapter (claude-code). Phase 1 adds airi. The realistic ceiling for a personal memory system used by one person is 3-5 adapters, not 15. If Compost ever reaches 10 simultaneous adapters, recompiling SQLite with `SQLITE_MAX_ATTACHED=125` is a one-line CMake flag and a `brew reinstall sqlite --build-from-source`. This is not the kind of problem that should drive the entire transaction topology decision today.

---

## 3. Concrete failure mode Option A survives that Option B does not

Scenario: Claude Code fires 5 hook events in rapid succession during a long tool-use chain (PreToolUse x3, PostToolUse x2). Simultaneously, the daemon's drain loop is mid-transaction on ledger.db pulling from the outbox, and `compost add notes.md` is running as a CLI command that also writes to ledger.db.

Under Option B, all five hook shim processes plus the drain loop plus `compost add` are racing for a write lock on the same `ledger.db` WAL file. SQLite WAL serializes these. Any single slow writer (the drain loop is doing `INSERT OR IGNORE` + `INSERT INTO ingest_queue` + `UPDATE`) holds the write lock for the full transaction duration. Hook shims time out waiting. Claude Code's hook dispatch has a default 5-second timeout per hook. If the drain loop takes 200ms per row and there are 50 pending rows, the drain loop's total critical-section time can exceed hook timeout under write pressure.

Under Option A, the five hook shims each write to `~/.compost/adapters/claude-code/outbox.db` — a small file with no concurrent writers other than other claude-code hook shims (which is fine, they are all the same adapter). The daemon's drain loop and `compost add` contend only on `ledger.db`. No interference path exists between the hook shim's append and the drain loop's ledger write. The hook shim's `BEGIN IMMEDIATE` on `outbox.db` never waits on ledger activity. Cold-start p95 stays deterministic.

---

## 4. Concrete concession

The `compost reflect` pruning race that the Codex reviewer flagged (§8.4) gets harder under Option A, not easier. Reflect needs to prune drained outbox rows across N separate files. Under Option B, pruning is a single DELETE with an adapter filter on one file. Under Option A, reflect must open each adapter outbox, acquire a per-outbox coordination signal with the daemon's drain loop (the spec currently has no such mechanism), and run the prune. The Codex reviewer is right that `reflect.lock` does not solve this. The fix — a per-outbox advisory lock or moving the prune into the drain loop itself — is extra work that Option B avoids entirely.

Backup is also marginally more complex under Option A: a complete snapshot requires `ledger.db` plus every `adapters/*/outbox.db`. A partial backup that omits the outbox files produces a restorable ledger but with a gap window. The spec's portability story needs to call this out explicitly.

---

## 5. Hook shim cold-start impact

Option A preserves the p95 < 30ms gate. The hook shim opens exactly one small file: `~/.compost/adapters/claude-code/outbox.db`. On an M-series Mac with warm filesystem cache, `better-sqlite3` open + WAL setup + single row INSERT + COMMIT benchmarks at approximately 8-12ms total. The spec's target of 20ms leaves 8ms headroom for process startup jitter. That headroom is viable only because `outbox.db` is small (drained rows are periodically pruned) and has no other concurrent writers during the hook's critical path.

Under Option B, the hook shim would open `ledger.db`. The ledger grows continuously — L0 facts, L1 chunks, ranking logs, access logs. A `ledger.db` at 6 months of use on an active developer workstation could be 50-200MB. SQLite does not read the whole file on open, but WAL mode does read the WAL file header and shared-memory mapping. On a cold filesystem (daemon just restarted, OS page cache cold), this adds 15-25ms of file I/O before the first INSERT can begin. That puts the p95 gate at risk for Option B on normal developer hardware, not just worst-case hardware. The measurement methodology in §3b.5 specifically notes that the cold-start gate is enforced on macOS with warm filesystem cache — but even warm-cache open of a large ledger.db under WAL is slower than warm-cache open of a small dedicated outbox file. Option A has no such risk.

---

## 6. ATTACH lifecycle protocol (Option A path forward)

The spec needs to add one section describing daemon ATTACH management:

**Startup**: After opening `ledger.db` as main connection, the daemon scans `~/.compost/adapters/*/outbox.db` and issues `ATTACH DATABASE '<path>' AS <adapter_name>` for each found file. Adapter names that conflict with SQLite reserved names are sanitized (replace `-` with `_`, prefix `a_` if leading digit).

**On-demand attach**: If the drain loop encounters a new adapter outbox (created by a hook shim while the daemon is running), it attaches it before the first drain transaction referencing that adapter.

**Detach on removal**: If an adapter outbox file is removed (adapter uninstalled), the daemon catches the ATTACH error on next drain attempt and issues `DETACH DATABASE <name>`. It logs the removal and removes it from its adapter registry.

**Limit enforcement**: The daemon tracks attached count. At >= 9 attached databases (leaving one slot for emergency attach operations), it logs a warning: "Approaching SQLite ATTACH limit — if you have more than 10 adapters, rebuild SQLite with SQLITE_MAX_ATTACHED=125. See docs/adapter-scaling.md." This is a Phase 3 concern; Phase 0 ships one adapter.

**Cross-file transaction syntax**: The canonical §1.6 drain SQL is updated to use `<adapter_alias>.observe_outbox` for the SELECT and UPDATE steps, while `observations` and `ingest_queue` remain unqualified (they live in main/ledger.db). The `ATTACH` guarantee is: if ledger.db is in WAL mode and the attached outbox.db is in WAL mode, `BEGIN IMMEDIATE` across both is atomic. Both files must be in WAL mode — this is already enforced by the §1.6 DDL (`PRAGMA journal_mode = WAL`).

This is the spec edit the Codex reviewer asked for. It is a documentation fix on top of a correct architectural choice, not an architectural reversal.
