import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { v7 as uuidv7 } from "uuid";
import type { EngramStreamEntry } from "./stream-puller";
import type { EmbeddingService } from "../../compost-core/src/embedding/types";
import type { VectorStore } from "../../compost-core/src/storage/lancedb";

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
  /**
   * Optional embedding pipeline. When BOTH are provided, ingestEngramEntry
   * embeds the new chunk and writes it to LanceDB so ANN retrieval can
   * actually surface this entry. Without these, the chunk lands in SQLite
   * but stays invisible to ANN — FTS5 still works but the original 11
   * markdown-extracted chunks dominate ranking, flattening cross-project
   * reasoning regardless of seed (dogfound 2026-04-25 alongside R3 fix).
   *
   * When only one is provided or both omitted, embedding is skipped
   * silently (graceful degradation; tests can keep using the no-embed
   * code path).
   */
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
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
 * SPO mapping from Engram entry to Compost (subject, predicate, object).
 *
 * Subject derivation (refined post 2026-04-25 dogfood, closes debate 021 R3):
 *   - `project` is non-null (most Engram entries) → subject = project name
 *   - scope='global' → subject = "global"
 *   - scope='meta'   → subject = "meta"  (cross-cutting user-model entries)
 *   - fallback                → subject = "user"
 *
 * Why: the original 2026-04-17 mapper always set subject="user". Dogfood
 * found that with 612 pulled Engram entries spanning 16 projects, every
 * fact collapsed to the same subject → FTS5/ANN retrieval flattened →
 * `compost reason` chains converged to whichever cluster was densest
 * regardless of seed. Project as subject restores the cross-project
 * differentiation that Engram's payload already carries — zero LLM,
 * zero schema change.
 *
 * Predicate stays kind (with friendly aliases for legacy life-domain
 * kinds — preference/goal/habit/etc — that pre-date the workflow kinds
 * Engram now actually emits).
 */
export function defaultSpoMapper(entry: EngramStreamEntry): FactTriple[] {
  const subject =
    entry.project ??
    (entry.scope === "global"
      ? "global"
      : entry.scope === "meta"
        ? "meta"
        : "user");
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
 *
 * Async since 2026-04-25: when caller provides `embeddingService` +
 * `vectorStore` in opts, the new chunk is embedded post-COMMIT and
 * written to LanceDB so ANN retrieval can surface it. Backwards
 * compatible: callers omitting the services see sync-equivalent
 * behavior (just `await` the returned Promise).
 */
export async function ingestEngramEntry(
  db: Database,
  entry: EngramStreamEntry,
  opts: IngestOptions = {}
): Promise<IngestResult> {
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
    engram_project: entry.project, // dogfood R3 fix — preserve so backfill
    engram_scope: entry.scope,     // queries can derive subject without
    engram_tags: entry.tags,       // re-pulling from Engram.
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

    const chunkId = uuidv7();
    db.run(
      `INSERT INTO chunks
         (chunk_id, observe_id, derivation_id, chunk_index, text_content,
          content_hash, char_start, char_end, transform_policy)
       VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)`,
      [
        chunkId,
        observeId,
        derivationId,
        entry.content,
        contentHash,
        entry.content.length,
        policy,
      ]
    );

    db.exec("COMMIT");

    // Post-commit: embed chunk and write to LanceDB if services provided.
    // Async + outside transaction because embedding is network I/O. If
    // embedding fails, the SQLite row stays — chunk will be visible to
    // FTS5/SQLite paths but invisible to ANN until a future backfill
    // pass embeds it. This graceful degradation is intentional (HC-1
    // independence) — Engram pull must not block on an unreachable
    // embedding service.
    if (opts.embeddingService && opts.vectorStore) {
      const factRow = db
        .query("SELECT fact_id FROM facts WHERE observe_id = ? LIMIT 1")
        .get(observeId) as { fact_id: string } | undefined;
      try {
        const [vector] = await opts.embeddingService.embed([entry.content]);
        if (vector) {
          await opts.vectorStore.add([
            {
              chunk_id: chunkId,
              fact_id: factRow?.fact_id ?? `orphan:${observeId}`,
              observe_id: observeId,
              vector,
            },
          ]);
          db.run(
            "UPDATE chunks SET embedded_at = datetime('now') WHERE chunk_id = ?",
            [chunkId]
          );
        }
      } catch (e) {
        // Swallow — see comment above. Caller log can read embedded_at
        // IS NULL chunks to find pending backfill.
      }
    }
  } catch (e) {
    // Best-effort rollback — DB.exec throws if no active transaction
    // (e.g. error happened post-COMMIT in the embedding block above).
    try {
      db.exec("ROLLBACK");
    } catch {}
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
