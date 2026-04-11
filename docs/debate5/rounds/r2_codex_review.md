### 1. Shippability verdict

**HOLD** — the central durability path is not implementable as written. §1.6 defines `observe_outbox` in a per-adapter SQLite file, then specifies one “canonical” transaction that reads `observe_outbox` and writes `observations` / `ingest_queue` in `ledger.db`. That is not a valid single-DB transaction unless the spec explicitly introduces `ATTACH` and a cross-file atomicity model, which it does not.

### 2. Top concerns still present

1. **Outbox drain transaction is structurally wrong** (§1.6, lines 453-545; §1, lines 151-210). The spec says each adapter has its own `outbox.db`, but the canonical SQL at lines 488-525 directly inserts into `observations` and `ingest_queue`, which live in `ledger.db`. Failure mode: the exact transaction the rest of the crash semantics depend on cannot run as written. Even if the intended implementation is `ATTACH`, the crash guarantees in lines 528-531 are not justified from the current text. Concrete fix: either move `observe_outbox` into `ledger.db`, or explicitly spec an attached-database implementation and rewrite the crash semantics/tests around that boundary.

2. **Outbox poison-pill handling is incomplete even inside §1.6** (§1.6, lines 491-496, 520-542). `drain_attempts` and `drain_error` exist in the DDL, but the canonical drain SQL never increments `drain_attempts`, never writes `drain_error`, and never excludes quarantined rows from the claim query. Failure mode: one malformed row at the head of the queue is selected forever, so the stated “quarantine after >5 attempts” cannot happen from the specified SQL. Concrete fix: add explicit failure SQL that updates `drain_attempts`/`drain_error`, plus a claim predicate that skips quarantined rows.

3. **The ingest lease protocol does not compose across §4.5, §10.2, and §11** (§4.5, lines 883-897; §10.2, lines 1501-1540; §11, line 1618). §4.5 says extraction quarantines at `attempts == 3` by setting `started_at = '1970-01-01'`; §10.2 says poison pills are quarantined at `attempts > 5`; the claim SQL never filters on `started_at` anyway, so the quarantine marker is inert. The timeout rule says “decrement `lease_expires_at`”, but §10.2 defines release as clearing the lease. Failure mode: two different retry state machines exist, and neither matches the claim SQL. Concrete fix: define one extraction queue state machine, one threshold, one admin command, one claim predicate, and one failure/release statement.

4. **Stage-1/Stage-2 bridge text is incorrect under SQLite semantics** (§5.1, lines 976-1113). The spec repeatedly says the temp table is “transaction-scoped” and “automatically disappears on rollback or commit.” That is false for `CREATE TEMP TABLE`; the table is connection-scoped and survives commit unless explicitly dropped. The sample code also mixes anonymous `?` placeholders for contexts with a named-parameter object in `.all(...)`, so it does not execute as written. Concrete fix: spec this as connection-scoped temp state with explicit cleanup, or use a dedicated connection per query and `DROP TABLE` in a finally path; fix the parameter binding example.

5. **`compost reflect` still races active drain workers** (§8.4, lines 1309-1318; §1.6, lines 540-545). Reflect opens every adapter outbox and runs a pruning `DELETE`, but the only lock described is `reflect.lock`, which does not coordinate with drain loops. Failure mode: concurrent writers on the same outbox DB can hit `SQLITE_BUSY`; the current behavior is just a soft error in `ReflectionReport`, with no retry/backoff/test requirement. Concrete fix: use a shared per-outbox lock, or move pruning into the drain loop.

### 3. New issues introduced by the patch

The v2.1 patch added detail, but it also added contradictions. The new quarantine text introduced `attempts == 3` vs `attempts > 5`, `compost doctor --drain-retry` vs `compost doctor --quarantine-purge`, and a daemon status requirement in §4.5 that §10.1 does not define. The new temp-table bridge also overclaims SQLite behavior and ships a pseudocode example that does not bind its own parameters correctly.

### 4. Cross-reference consistency

- §3.1-3.2 (lines 623-655) still describes the legacy adapter-managed outbox (`notify`, `markSent`, `replayUnacked`), while §1.6 defines a daemon-drained outbox with `drained_at` / `observe_id`. Those are different protocols.
- §10.1 status output (lines 1491-1495) omits `degraded_flags`, but §4.5 and §11 require degraded/quarantine state to surface.
- §11 says all six crash scenarios are covered, but the extraction crash case depends on “idempotent on retry” behavior for partial fact/vector writes that is never specified in §4 or §10.

### 5. Personal sign-off

I would not approve this for coding today. The remaining defects are concentrated on the crash/concurrency spine: the outbox transaction boundary is undefined, the lease/quarantine model is internally contradictory, and the SQLite bridge/write examples are not executable as written. Fix those three areas and this likely becomes “ship with required changes”; until then, it is premature.
