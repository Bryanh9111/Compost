/**
 * Phase 7 L5 — hybrid reasoning scheduler (debate 026 entry slice).
 *
 * Periodically picks "high-value" seeds and runs `runReasoning()` over them.
 * Verdict-feedback gates (debate 026 §Q3 (iv)) prevent runaway LLM spend
 * when output quality regresses. State persists in `reasoning_scheduler_state`
 * (migration 0020) so cooldown survives daemon restart.
 *
 * Synthesis decisions (debate 026, 4-way Opus/Sonnet/Gemini/Codex):
 *   Q1=(c) recently-active subjects + surge guard (Sonnet+Codex 2/4, Codex
 *   demolished (a) gaps with `open_gaps_ask2=0` ledger evidence — Opus
 *   conceded). Q2=(p) fixed 6h max N=3 (3/4 vs Gemini (r) lone). Q3=(iv)
 *   double-layer + Opus 7d auto-resume (Gemini+Codex 2/4 + Opus modifier).
 *   Q4=(A) migration 0020 single-row table (4/4 unanimous). Q5=(II) CLI +
 *   read-only MCP (3/4 vs Gemini (III) lone).
 *
 * On-demand `runReasoning()` and `compost reason run` paths remain first-class
 * and unaffected (HC-1 from debate 025 §Q4 unchanged).
 */

import type { Database } from "bun:sqlite";
import type { LLMService } from "../llm/types";
import type { BreakerRegistry } from "../llm/breaker-registry";
import type { VectorStore } from "../storage/lancedb";
import { runReasoning } from "./reasoning";

// ---------------------------------------------------------------------------
// Constants — tuned per debate 026 synthesis + HC-6 LLM cost ceiling
// ---------------------------------------------------------------------------

/** Max chains per cycle. HC-6: gemma4:31b ~60-90s/chain on Mac mini = ~5min total. */
export const SCHEDULER_BUDGET = 3;

/** Tick interval. Matches reflect cadence but runs in an INDEPENDENT timer
 * (Codex argument: coupling reflect→reasoning means reflect failures stall
 * reasoning per `scheduler.ts:104,120,135` swallow-and-continue pattern). */
export const SCHEDULER_TICK_MS = 6 * 60 * 60 * 1000;

/** Soft gate threshold: skip current cycle if recent rejected-rate >= this. */
export const SOFT_GATE_REJECTED_RATE = 0.5;

/** Window size for soft gate (last N judged chains). */
export const SOFT_GATE_WINDOW = 10;

/** Bootstrap floor: don't apply soft gate until we have at least this many
 * judgments (small N is too noisy to trust). */
export const SOFT_GATE_MIN_JUDGED = 5;

/** K consecutive soft skips → write paused=true (hard gate). */
export const HARD_GATE_CONSECUTIVE_SKIPS = 4;

/** Auto-resume hard pause after this many hours (Opus addition: pure manual
 * resume risks user-forgets → product death). */
export const HARD_GATE_AUTO_RESUME_HOURS = 24 * 7;

/** debate 026 entry condition (chain count floor before scheduler activates). */
export const ENTRY_CHAIN_COUNT = 10;

/** Recently-active window for seed selection (Q1 (c)). */
export const RECENT_ACTIVE_DAYS = 7;

/** Top N subjects per cycle (matches SCHEDULER_BUDGET). */
export const TOP_SUBJECTS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateDecision =
  | "ran"
  | "skipped_soft"
  | "skipped_hard_paused"
  | "skipped_below_entry"
  | "skipped_no_seeds";

export interface CycleStats {
  triggered_at: string;
  chains_attempted: number;
  chains_succeeded: number;
  chains_skipped_idempotent: number;
  seeds_selected: string[];
  gate_decision: GateDecision;
  gate_detail?: string;
}

export interface SchedulerState {
  paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
  last_cycle_at: string | null;
  last_cycle_stats: CycleStats | null;
  consecutive_skipped_cycles: number;
}

export interface RecentVerdictStats {
  judged: number;
  confirmed: number;
  refined: number;
  rejected: number;
  rejected_rate: number;
}

// ---------------------------------------------------------------------------
// State read/write
// ---------------------------------------------------------------------------

export function readState(db: Database): SchedulerState {
  const row = db
    .query("SELECT * FROM reasoning_scheduler_state WHERE id = 1")
    .get() as Record<string, unknown> | null;
  if (!row) {
    // Migration 0020 INSERTs the singleton row; missing means migrations
    // didn't run. Fail loud rather than fabricate state.
    throw new Error(
      "reason-scheduler: state row missing (id=1). Did migration 0020 run?"
    );
  }
  const statsJson = row.last_cycle_stats_json as string | null;
  return {
    paused: (row.paused as number) === 1,
    paused_reason: (row.paused_reason as string | null) ?? null,
    paused_at: (row.paused_at as string | null) ?? null,
    last_cycle_at: (row.last_cycle_at as string | null) ?? null,
    last_cycle_stats: statsJson ? (JSON.parse(statsJson) as CycleStats) : null,
    consecutive_skipped_cycles:
      (row.consecutive_skipped_cycles as number | null) ?? 0,
  };
}

interface StatePatch {
  paused?: boolean;
  paused_reason?: string | null;
  paused_at?: string | null;
  last_cycle_at?: string | null;
  last_cycle_stats?: CycleStats | null;
  consecutive_skipped_cycles?: number;
}

export function writeState(db: Database, patch: StatePatch): void {
  // Build dynamic UPDATE; pass through nulls explicitly so callers can clear
  // fields (e.g. resume sets paused_reason=null).
  const sets: string[] = [];
  const params: unknown[] = [];
  if ("paused" in patch) {
    sets.push("paused = ?");
    params.push(patch.paused ? 1 : 0);
  }
  if ("paused_reason" in patch) {
    sets.push("paused_reason = ?");
    params.push(patch.paused_reason ?? null);
  }
  if ("paused_at" in patch) {
    sets.push("paused_at = ?");
    params.push(patch.paused_at ?? null);
  }
  if ("last_cycle_at" in patch) {
    sets.push("last_cycle_at = ?");
    params.push(patch.last_cycle_at ?? null);
  }
  if ("last_cycle_stats" in patch) {
    sets.push("last_cycle_stats_json = ?");
    params.push(
      patch.last_cycle_stats ? JSON.stringify(patch.last_cycle_stats) : null
    );
  }
  if ("consecutive_skipped_cycles" in patch) {
    sets.push("consecutive_skipped_cycles = ?");
    params.push(patch.consecutive_skipped_cycles ?? 0);
  }
  if (sets.length === 0) return;
  db.run(
    `UPDATE reasoning_scheduler_state SET ${sets.join(", ")} WHERE id = 1`,
    params
  );
}

// ---------------------------------------------------------------------------
// Verdict-window helper (Codex's prerequisite — closes existing
// `getVerdictStats()` global-aggregate gap. Soft gate needs *recent*, not
// all-time, signal.)
// ---------------------------------------------------------------------------

export function getRecentVerdictStats(
  db: Database,
  limit: number = SOFT_GATE_WINDOW
): RecentVerdictStats {
  const rows = db
    .query(
      `SELECT user_verdict
       FROM reasoning_chains
       WHERE user_verdict IS NOT NULL
       ORDER BY verdict_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ user_verdict: string }>;
  let confirmed = 0;
  let refined = 0;
  let rejected = 0;
  for (const r of rows) {
    if (r.user_verdict === "confirmed") confirmed++;
    else if (r.user_verdict === "refined") refined++;
    else if (r.user_verdict === "rejected") rejected++;
  }
  const judged = confirmed + refined + rejected;
  return {
    judged,
    confirmed,
    refined,
    rejected,
    rejected_rate: judged > 0 ? rejected / judged : 0,
  };
}

// ---------------------------------------------------------------------------
// Seed selection — (c) recently-active subjects + surge guard
// ---------------------------------------------------------------------------

export interface SchedulerSeed {
  kind: "fact";
  id: string;
  /** subject the seed represents (for telemetry / dedup). */
  subject: string;
}

/**
 * Pick `budget` seeds from recently-active subjects, excluding bulk-imported
 * Engram facts (Codex+Sonnet surge guard).
 *
 * Algorithm:
 *   1. Window: facts created in last RECENT_ACTIVE_DAYS days
 *   2. Surge filter: exclude observations with adapter='engram'
 *      (engram-pull is canonical KB import, not "user activity";
 *      ingest-adapter.ts:12 ENGRAM_ADAPTER constant)
 *   3. Group by subject, rank by most-recent fact created_at
 *   4. Take top TOP_SUBJECTS subjects (capped at budget)
 *   5. Per subject, return the single most-recent unarchived fact
 *
 * Returns fewer seeds than budget when ledger is sparse — caller must handle
 * empty / partial result (cycle gate decision = skipped_no_seeds).
 */
export function selectSeeds(
  db: Database,
  budget: number = SCHEDULER_BUDGET
): SchedulerSeed[] {
  const cap = Math.min(budget, TOP_SUBJECTS);
  const rows = db
    .query(
      `SELECT f.fact_id, f.subject, MAX(f.created_at) AS latest
       FROM facts f
       JOIN observations o ON o.observe_id = f.observe_id
       WHERE f.archived_at IS NULL
         AND f.created_at > datetime('now', ?)
         AND o.adapter != 'engram'
       GROUP BY f.subject
       ORDER BY latest DESC
       LIMIT ?`
    )
    .all(`-${RECENT_ACTIVE_DAYS} days`, cap) as Array<{
    fact_id: string;
    subject: string;
  }>;
  return rows.map((r) => ({
    kind: "fact" as const,
    id: r.fact_id,
    subject: r.subject,
  }));
}

// ---------------------------------------------------------------------------
// Cycle gate (debate 026 §Q3 (iv) double-layer + Opus 7d auto-resume)
// ---------------------------------------------------------------------------

export interface GateResult {
  decision: GateDecision;
  detail: string;
}

/**
 * Decide whether the scheduler should run this cycle. Layers:
 *   1. Below-entry — fewer than ENTRY_CHAIN_COUNT total chains. The verdict
 *      signal channel needs bootstrap data first; pre-bootstrap, on-demand
 *      reason path is still available.
 *   2. Hard gate — paused=true. Unless paused for >7 days, in which case
 *      auto-resume + proceed with soft-gate eval. Auto-resume side-effects
 *      (state writes) happen here.
 *   3. Soft gate — recent rejected_rate >= 50% (with bootstrap floor of
 *      SOFT_GATE_MIN_JUDGED). Increment consecutive_skipped_cycles; if
 *      that hits HARD_GATE_CONSECUTIVE_SKIPS, transition to hard pause.
 *
 * Pure function side-effects: hard pause transition + auto-resume write.
 * Caller (runCycle) handles last_cycle_at + last_cycle_stats writes.
 */
export function canTriggerCycle(db: Database): GateResult {
  // 1. Below-entry check
  const chainCount = (
    db
      .query("SELECT COUNT(*) AS n FROM reasoning_chains")
      .get() as { n: number }
  ).n;
  if (chainCount < ENTRY_CHAIN_COUNT) {
    return {
      decision: "skipped_below_entry",
      detail: `chains=${chainCount} < entry=${ENTRY_CHAIN_COUNT}`,
    };
  }

  // 2. Hard gate
  const state = readState(db);
  if (state.paused) {
    if (state.paused_at) {
      const pausedMs = Date.parse(state.paused_at + "Z");
      const ageMs = Date.now() - pausedMs;
      const autoResumeMs = HARD_GATE_AUTO_RESUME_HOURS * 60 * 60 * 1000;
      if (ageMs >= autoResumeMs) {
        // Auto-resume: clear paused state. Continue to soft-gate eval.
        writeState(db, {
          paused: false,
          paused_reason: null,
          paused_at: null,
          consecutive_skipped_cycles: 0,
        });
      } else {
        return {
          decision: "skipped_hard_paused",
          detail: `paused since ${state.paused_at}: ${state.paused_reason ?? "(no reason)"}`,
        };
      }
    } else {
      // Paused but no paused_at — defensive: treat as still paused, can't
      // compute auto-resume window. User must manual-resume.
      return {
        decision: "skipped_hard_paused",
        detail: `paused with no paused_at; manual resume required`,
      };
    }
  }

  // 3. Soft gate
  const verdict = getRecentVerdictStats(db, SOFT_GATE_WINDOW);
  if (
    verdict.judged >= SOFT_GATE_MIN_JUDGED &&
    verdict.rejected_rate >= SOFT_GATE_REJECTED_RATE
  ) {
    const refreshedState = readState(db); // re-read after possible auto-resume above
    const newConsecutive = refreshedState.consecutive_skipped_cycles + 1;
    if (newConsecutive >= HARD_GATE_CONSECUTIVE_SKIPS) {
      // Soft → Hard transition
      writeState(db, {
        paused: true,
        paused_reason: `verdict cooldown: ${newConsecutive} consecutive soft skips, recent ${verdict.rejected}/${verdict.judged} rejected`,
        paused_at: new Date().toISOString().replace("T", " ").slice(0, 19),
        consecutive_skipped_cycles: newConsecutive,
      });
      return {
        decision: "skipped_hard_paused",
        detail: `transitioned to hard pause after ${newConsecutive} consecutive soft skips`,
      };
    }
    writeState(db, { consecutive_skipped_cycles: newConsecutive });
    return {
      decision: "skipped_soft",
      detail: `recent ${verdict.rejected}/${verdict.judged} rejected (rate ${(verdict.rejected_rate * 100).toFixed(0)}%); consecutive=${newConsecutive}/${HARD_GATE_CONSECUTIVE_SKIPS}`,
    };
  }

  return { decision: "ran", detail: "all gates passed" };
}

// ---------------------------------------------------------------------------
// Run a cycle
// ---------------------------------------------------------------------------

/**
 * Execute one scheduler cycle. Idempotent in the sense that repeated calls
 * with same seed → reasoning.ts returns the cached chain (debate 024 contract
 * preserved). On gate skip, persists last_cycle_stats so CLI/MCP status can
 * surface why.
 *
 * Does NOT throw on per-seed reasoning failure — failures are folded into
 * `chains_attempted` count and logged via reasoning.ts's own failure_reason
 * (chain row written with chain=null + status='active'). One bad seed doesn't
 * stall the cycle.
 */
export async function runCycle(
  db: Database,
  llm: LLMService | BreakerRegistry,
  vectorStore?: VectorStore,
  budget: number = SCHEDULER_BUDGET
): Promise<CycleStats> {
  const triggeredAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const gate = canTriggerCycle(db);

  if (gate.decision !== "ran") {
    const stats: CycleStats = {
      triggered_at: triggeredAt,
      chains_attempted: 0,
      chains_succeeded: 0,
      chains_skipped_idempotent: 0,
      seeds_selected: [],
      gate_decision: gate.decision,
      gate_detail: gate.detail,
    };
    writeState(db, { last_cycle_at: triggeredAt, last_cycle_stats: stats });
    return stats;
  }

  const seeds = selectSeeds(db, budget);
  if (seeds.length === 0) {
    const stats: CycleStats = {
      triggered_at: triggeredAt,
      chains_attempted: 0,
      chains_succeeded: 0,
      chains_skipped_idempotent: 0,
      seeds_selected: [],
      gate_decision: "skipped_no_seeds",
      gate_detail: "no recent non-engram facts in window",
    };
    writeState(db, { last_cycle_at: triggeredAt, last_cycle_stats: stats });
    return stats;
  }

  let succeeded = 0;
  let idempotent = 0;
  for (const seed of seeds) {
    try {
      const chain = await runReasoning(
        db,
        { kind: seed.kind, id: seed.id },
        llm,
        {},
        vectorStore
      );
      if (chain.reused_existing) idempotent++;
      else if (chain.answer.chain !== null) succeeded++;
    } catch {
      // Per-seed failure swallowed — cycle continues. reasoning.ts already
      // logs failure_reason at the chain row level for non-throwing paths;
      // throws here mean seed resolution failed (e.g. fact archived between
      // selectSeeds and runReasoning). Not worth pausing the whole cycle.
    }
  }

  const stats: CycleStats = {
    triggered_at: triggeredAt,
    chains_attempted: seeds.length,
    chains_succeeded: succeeded,
    chains_skipped_idempotent: idempotent,
    seeds_selected: seeds.map((s) => `${s.kind}=${s.id}`),
    gate_decision: "ran",
    gate_detail: gate.detail,
  };
  // Successful run resets the soft-skip counter; preserves verdict-driven
  // recovery semantics (one good cycle clears the soft-pause buildup).
  writeState(db, {
    last_cycle_at: triggeredAt,
    last_cycle_stats: stats,
    consecutive_skipped_cycles: 0,
  });
  return stats;
}

// ---------------------------------------------------------------------------
// Manual control (called by CLI)
// ---------------------------------------------------------------------------

export function pauseScheduler(db: Database, reason: string): void {
  writeState(db, {
    paused: true,
    paused_reason: reason,
    paused_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  });
}

export function resumeScheduler(db: Database): void {
  writeState(db, {
    paused: false,
    paused_reason: null,
    paused_at: null,
    consecutive_skipped_cycles: 0,
  });
}

