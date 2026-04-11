I will begin by reading the prompt file and the target specification to understand the review requirements and the current state of the document.
I will list the contents of the project's temporary directory to locate the prompt file.
I will search for the prompt file within the workspace to see if it has been moved or copied.
I will attempt to locate the prompt file using a shell command to see if it is accessible.
I will read the prompt file using a shell command to understand the review requirements.
This review evaluates the **v2.1 specification** of Compost. Having performed a fresh-eyes analysis of the patched document, I have identified several critical regressions, cross-reference failures, and schema gaps that would lead to runtime failures or data loss during implementation.

### 1. Shippability verdict
**SHIP WITH REQUIRED CHANGES** — The core architecture is robust, but the v2.1 patch pass introduced significant inconsistencies in the L0 drain transaction and the sensory-GC foreign key chain. These five specific fixes (detailed below) must be applied to the spec before the "2-week solo build" can safely commence.

### 2. Top concerns still present
*   **§1.6 / §3b.2 — Undefined source_kind in Drain:** Step 4 of the canonical drain transaction (§1.6) inserts into `ingest_queue` using a `:source_kind` parameter. However, the `observe_outbox` DDL in §1.6 does not contain a `source_kind` column, and the hook contract in §3b.2/§3b.2a does not include `source_kind` in the envelope. The daemon will be unable to populate this required `ingest_queue` column during drain, causing all outbox ingestions to fail.
    *   *Fix:* Add `source_kind` to `observe_outbox` DDL and ensure the hook shim populates it.
*   **§3b.2 / §1.1 — Hook Source Auto-Registration Gap:** The Claude Code hook shim generates dynamic `source_id` strings (e.g., `claude-code:{session_id}:{cwd}`). However, §1.1 declares `observations.source_id` as a `REFERENCES source(id)` FK. Nothing in the hook shim (§3b.2) or the drain transaction (§1.6) handles the registration of these sources in the `source` table. All hook drains will fail with a `FOREIGN KEY constraint failed` error on the ledger.
    *   *Fix:* Update the drain transaction in §1.6 to `INSERT OR IGNORE` into the `source` table before inserting into `observations`.

### 3. New issues introduced by the patch
*   **§1.2 / §8.4 — Broken Sensory-GC Chain:** The v2.1 patch pass correctly added `ON DELETE CASCADE` to most tables, but missed `wiki_page_observe` in §1.2. The DDL for `wiki_page_observe.observe_id` is missing the cascade, despite §8.4 explicitly claiming it cascades. In Phase 0, any attempt by `compost reflect` to delete a sensory observation linked to a wiki page will be blocked by a `RESTRICT` error, halting the GC loop.
*   **§1.4 / §11 — Audit Log GC Blocker:** Similarly, the new `ranking_audit_log` table (§1.4) has a `fact_id` FK that is missing `ON DELETE CASCADE`. Since every query result is logged here, sensory facts (which are hard-deleted after 7 days) will be blocked from deletion by the audit trail. This renders the Phase 0 "hard-GC" impossible.
*   **§5.1 — SQL Parameter/Positional Mismatch:** The patched `query()` pseudocode uses named parameters (e.g., `:w1_semantic`) alongside a spread of `opts.contexts` for positional parameters (`?`) in the `contextFilter`. Passing an object with numeric keys (from the spread array) mixed with named keys to `better-sqlite3`'s `.all()` is brittle and likely to bind incorrectly or throw, especially since the spreading doesn't account for the 1-based index or named mapping requirements of the driver.

### 4. Cross-reference consistency
*   **§3.1 / §5 vs §1.6 (Context Loss):** `ObserveEvent` correctly includes a `contexts` array for `source_context` links. However, the canonical drain transaction in §1.6 ignores this field entirely. These links are lost during the transition from outbox to ledger.
*   **§5 vs §6 (API Role Conflict):** §5 defines `compost.observe` as returning a `Promise<ObserveResult>`, but §6 classifies it as an MCP "notification." In MCP, notifications are one-way (void); this makes it impossible for the client to receive the `observe_id` or `stored` status promised in §5.
*   **§5.1 vs §8.3 (Ranking Factor Count):** The §5.1 SQL rerank calculates 4 factors (w1-w4), but the §8.3 ranking formula describes 7 factors. While Phase 0 only uses w1, the "Core API" section should be consistent with the full model described in the cognitive layer.

### 5. Personal sign-off
As tech lead, I would NOT approve this for coding today without the five fixes identified in Section 2 and 3. While the spec is beautifully detailed, the "executable" parts—specifically the SQL drain transaction and the FK cascade definitions—contain just enough drift to guarantee a failed implementation. If we are promising a 2-week delivery, we cannot afford to spend Day 3 debugging why the hook shim's outbox is "quarantined" because of a missing `source_kind` or a blocked FK delete. Fix the drain logic and the cascade chain, and this becomes a gold-standard spec.
