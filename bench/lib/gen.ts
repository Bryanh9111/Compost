/**
 * Fixture generator for benches.
 *
 * Deterministic, PII-safe: uses a linear congruential generator seeded from
 * the row index so runs are reproducible. No real CC numbers, no real
 * API tokens, no real personal data — the generated content is synthetic
 * lorem-ipsum tokens that cannot accidentally trip the PII redactor.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "crypto";

const LOREM_TOKENS = [
  "compost",
  "fact",
  "observation",
  "wiki",
  "session",
  "project",
  "context",
  "memory",
  "ingest",
  "reflect",
  "decay",
  "policy",
  "derive",
  "chunk",
  "index",
  "query",
  "rank",
  "synthesize",
  "contradict",
  "resolve",
  "provenance",
  "trust",
  "tier",
  "audit",
  "commit",
  "plan",
  "build",
  "test",
  "verify",
  "report",
];

/** Deterministic pseudo-random int in [0, n). */
function det(seed: number, n: number): number {
  // Park-Miller LCG
  const a = 48271;
  const m = 2147483647;
  const x = ((seed * a) % m + m) % m;
  return x % Math.max(1, n);
}

function sentence(seed: number, wordCount: number = 12): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const tok = LOREM_TOKENS[det(seed * 31 + i, LOREM_TOKENS.length)] ?? "word";
    words.push(tok);
  }
  return words.join(" ");
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Seed a `source` row of kind "sensory" so sensory-GC tests have something
 * to cascade from. Returns the source_id.
 */
export function seedSensorySource(db: Database, id: string = "bench-sensory"): string {
  db.run(
    `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier)
     VALUES (?, ?, 'sensory', 'first_party')`,
    [id, `sensory://${id}`]
  );
  return id;
}

/**
 * Insert N synthetic observations into the ledger, all attributed to the
 * given source_id. occurred_at is offset back in time so sensory-GC
 * reflect() actually finds something to collect (default: 30 days ago).
 */
export function seedObservations(
  db: Database,
  sourceId: string,
  count: number,
  opts: { daysBack?: number; policyId?: string } = {}
): string[] {
  const daysBack = opts.daysBack ?? 30;
  const policyId = opts.policyId ?? "tp-2026-04";
  const observeIds: string[] = [];

  const insert = db.prepare(
    `INSERT INTO observations (
       observe_id, source_id, source_uri, occurred_at, captured_at,
       content_hash, raw_hash, mime_type, adapter, adapter_sequence,
       trust_tier, idempotency_key, transform_policy
     ) VALUES (?, ?, ?,
               datetime('now', '-' || ? || ' days'),
               datetime('now', '-' || ? || ' days'),
               ?, ?, 'text/plain', 'bench-adapter', ?, 'first_party', ?, ?)`
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const content = sentence(i + 1, 20);
      const obsId = `obs-bench-${sha(`${sourceId}-${i}`).slice(0, 16)}`;
      insert.run(
        obsId,
        sourceId,
        `sensory://${sourceId}/row/${i}`,
        daysBack,
        daysBack,
        sha(content).slice(0, 32),
        sha(content + "raw").slice(0, 32),
        i,
        `idem-${obsId}`,
        policyId
      );
      observeIds.push(obsId);
    }
  });
  tx();

  return observeIds;
}

/**
 * Insert N facts, each linked to an observation. Requires observe_ids
 * of length >= count (reuse the list returned by seedObservations).
 */
export function seedFacts(
  db: Database,
  observeIds: string[],
  count: number
): string[] {
  const n = Math.min(count, observeIds.length);
  const factIds: string[] = [];

  const insert = db.prepare(
    `INSERT INTO facts (
       fact_id, subject, predicate, object, confidence, importance, observe_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const subject = sentence(i * 3 + 1, 3);
      const predicate = LOREM_TOKENS[det(i * 7, LOREM_TOKENS.length)] ?? "relates";
      const object = sentence(i * 3 + 2, 6);
      const fid = `fact-bench-${sha(`${observeIds[i]}-fact`).slice(0, 16)}`;
      insert.run(
        fid,
        subject,
        predicate,
        object,
        0.8,
        0.5,
        observeIds[i] as string
      );
      factIds.push(fid);
    }
  });
  tx();

  return factIds;
}

/**
 * Seed chunks for FTS5 / BM25 benches. Each chunk is associated with an
 * observation and contains synthetic lorem text. Also seeds the required
 * derivation_run parent row (FK: chunks.derivation_id → derivation_run).
 *
 * Every chunk's text_content includes the search term "compost" once, so
 * bm25 queries for "compost" return real hits at predictable density.
 */
export function seedChunks(
  db: Database,
  observeIds: string[],
  count: number,
  opts: { policyId?: string } = {}
): string[] {
  const n = Math.min(count, observeIds.length);
  const policyId = opts.policyId ?? "tp-2026-04";
  const chunkIds: string[] = [];

  const insertDerivation = db.prepare(
    `INSERT INTO derivation_run (
       derivation_id, observe_id, layer, transform_policy, status
     ) VALUES (?, ?, 'L1', ?, 'succeeded')`
  );

  const insertChunk = db.prepare(
    `INSERT INTO chunks (
       chunk_id, observe_id, derivation_id, chunk_index, text_content,
       content_hash, char_start, char_end, transform_policy
     ) VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const content = `compost ${sentence(i, 29)}`;
      const obsId = observeIds[i] as string;
      const did = `deriv-bench-${sha(`${obsId}-d`).slice(0, 16)}`;
      const cid = `chunk-bench-${sha(`${obsId}-chunk`).slice(0, 16)}`;
      insertDerivation.run(did, obsId, policyId);
      insertChunk.run(
        cid,
        obsId,
        did,
        content,
        sha(content).slice(0, 32),
        content.length,
        policyId
      );
      chunkIds.push(cid);
    }
  });
  tx();

  return chunkIds;
}
