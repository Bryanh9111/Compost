import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { v7 as uuidv7 } from "uuid";
import type { EngramStreamEntry } from "./stream-puller";

// Source row id reused for all Engram-origin observations. Single row in
// the `source` table keyed by this id; one-time seed via ensureEngramSource().
export const ENGRAM_SOURCE_ID = "engram-stream";
export const ENGRAM_SOURCE_URI_ROOT = "engram://memory";
export const ENGRAM_ADAPTER = "engram";
// Reuse 'sensory' source kind per debate 021 synthesis — Engram is a
// streaming event source and semantically fits. Revisit with Migration 0017
// if Phase 7 reasoning exposes semantic ambiguity.
export const ENGRAM_SOURCE_KIND = "sensory" as const;

export interface IngestResult {
  observe_id: string;
  inserted: "new" | "duplicate";
  fact_count: number;
  chunk_count: number;
}

export interface IngestOptions {
  transformPolicy?: string;
  // Caller can override SPO mapping. Defaults to best-effort per-kind.
  spoMapper?: (entry: EngramStreamEntry) => FactTriple[];
}

export interface FactTriple {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
}

const DEFAULT_TRANSFORM_POLICY = "tp-2026-04";

/**
 * Seed the `source` table row Engram observations hang off. Idempotent;
 * safe to call at adapter startup. Run once per ledger database.
 */
export function ensureEngramSource(db: Database): void {
  db.run(
    `INSERT OR IGNORE INTO source
       (id, uri, kind, refresh_sec, coverage_target, trust_tier, created_at, paused_at)
     VALUES (?, ?, ?, NULL, 0.0, 'user', datetime('now'), NULL)`,
    [ENGRAM_SOURCE_ID, ENGRAM_SOURCE_URI_ROOT, ENGRAM_SOURCE_KIND]
  );
}

/**
 * Best-effort SPO mapping from Engram entry.kind to Compost (subject,
 * predicate, object). Phase 7 reasoning will refine these; the mapping
 * here is deliberately flat so downstream reasoning sees every Engram
 * claim even when the predicate is imprecise. Debate 021 R3.
 */
export function defaultSpoMapper(entry: EngramStreamEntry): FactTriple[] {
  const subject = "user";
  const object = entry.content;
  const basePredicateByKind: Record<string, string> = {
    preference: "prefers",
    goal: "aims-at",
    habit: "habitually",
    person: "knows-person",
    note: "noted",
    event: "experienced",
    reflection: "reflected",
  };
  const predicate = basePredicateByKind[entry.kind] ?? entry.kind;
  return [{ subject, predicate, object }];
}

/**
 * Direct ingest: write observation + facts + chunks rows for one Engram
 * entry, bypassing outbox + Python extractor. Rationale: Engram payloads
 * are already structured; re-running them through the NLP extractor would
 * hallucinate additional facts (debate 021 Sonnet finding).
 *
 * Idempotent via observations.UNIQUE(adapter, source_id, idempotency_key).
 * Returns the pre-existing observe_id + `duplicate` status if already
 * ingested, letting callers skip downstream work safely.
 */
export function ingestEngramEntry(
  db: Database,
  entry: EngramStreamEntry,
  opts: IngestOptions = {}
): IngestResult {
  const policy = opts.transformPolicy ?? DEFAULT_TRANSFORM_POLICY;
  const idempotencyKey = `engram:${entry.memory_id}`;
  const sourceUri = `${ENGRAM_SOURCE_URI_ROOT}/${entry.memory_id}`;

  const existing = db
    .query(
      `SELECT observe_id FROM observations
       WHERE adapter = ? AND source_id = ? AND idempotency_key = ?`
    )
    .get(ENGRAM_ADAPTER, ENGRAM_SOURCE_ID, idempotencyKey) as
    | { observe_id: string }
    | undefined;

  if (existing) {
    const factCount = db
      .query("SELECT COUNT(*) AS n FROM facts WHERE observe_id = ?")
      .get(existing.observe_id) as { n: number };
    const chunkCount = db
      .query("SELECT COUNT(*) AS n FROM chunks WHERE observe_id = ?")
      .get(existing.observe_id) as { n: number };
    return {
      observe_id: existing.observe_id,
      inserted: "duplicate",
      fact_count: factCount.n,
      chunk_count: chunkCount.n,
    };
  }

  const observeId = uuidv7();
  const trustTier = entry.origin === "agent" ? "first_party" : "user";
  const contentBuffer = Buffer.from(entry.content, "utf-8");
  const contentHash = sha256(entry.content);
  const rawJson = JSON.stringify(entry);
  const rawHash = sha256(rawJson);
  const originHash = sha256(
    `${ENGRAM_ADAPTER}|${sourceUri}|${idempotencyKey}`
  );
  const metadata = JSON.stringify({
    engram_kind: entry.kind,
    engram_scope: entry.scope,
    engram_tags: entry.tags,
    engram_origin: entry.origin,
    engram_updated_at: entry.updated_at,
  });

  const derivationId = uuidv7();
  const mapper = opts.spoMapper ?? defaultSpoMapper;
  const triples = mapper(entry);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.run(
      `INSERT INTO observations
         (observe_id, source_id, source_uri, occurred_at, captured_at,
          content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
          adapter, adapter_sequence, trust_tier, idempotency_key,
          transform_policy, metadata, origin_hash, method)
       VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, NULL, 'application/json',
               ?, 1, ?, ?, ?, ?, ?, 'engram')`,
      [
        observeId,
        ENGRAM_SOURCE_ID,
        sourceUri,
        entry.created_at,
        contentHash,
        rawHash,
        contentBuffer,
        ENGRAM_ADAPTER,
        trustTier,
        idempotencyKey,
        policy,
        metadata,
        originHash,
      ]
    );

    db.run(
      `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status, finished_at)
       VALUES (?, ?, 'L2', ?, 'succeeded', datetime('now'))`,
      [derivationId, observeId, policy]
    );

    const insertFact = db.prepare(
      `INSERT INTO facts
         (fact_id, subject, predicate, object, confidence, importance,
          observe_id, last_reinforced_at_unix_sec, half_life_seconds)
       VALUES (?, ?, ?, ?, ?, 0.5, ?, ?, 2592000)`
    );
    const nowUnixSec = Math.floor(Date.now() / 1000);
    for (const t of triples) {
      insertFact.run(
        uuidv7(),
        t.subject,
        t.predicate,
        t.object,
        t.confidence ?? 0.8,
        observeId,
        nowUnixSec
      );
    }

    db.run(
      `INSERT INTO chunks
         (chunk_id, observe_id, derivation_id, chunk_index, text_content,
          content_hash, char_start, char_end, transform_policy)
       VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)`,
      [
        uuidv7(),
        observeId,
        derivationId,
        entry.content,
        contentHash,
        entry.content.length,
        policy,
      ]
    );

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return {
    observe_id: observeId,
    inserted: "new",
    fact_count: triples.length,
    chunk_count: 1,
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
