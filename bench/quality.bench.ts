/**
 * quality.bench.ts — measures wiki synthesis quality via LLM-as-judge.
 *
 * Network-gated: only runs with COMPOST_BENCH_NETWORK=true. Needs a
 * running Ollama daemon (default model gemma4:31b, override with
 * COMPOST_BENCH_JUDGE_MODEL).
 *
 * Rationale (2026-04-30 integration debate, Engram pinned 2b2955d569a6 +
 * Compost pinned b73625577d5c): Compost's existing benches are
 * latency-only (sqlite-reflect / sqlite-query / lancedb-ann / llm-latency).
 * Phase 6 curiosity and Phase 7 L5 reasoning need a quality regression
 * gate, not just latency. Inspired by opik's LLM-as-judge pattern but
 * implemented locally over Ollama — no opik dep, no external service,
 * matches HC-1 independence + MIT fork-template identity.
 *
 * Surface measured: wiki synthesis (`synthesizeWiki`). For each fixture
 * we seed a known fact set, run synthesis, and ask the local judge to
 * score (a) coverage of the input facts, (b) hallucination count of
 * statements not derivable from the facts, (c) overall faithfulness.
 *
 * Output: one JSON line per fixture + one aggregate line. Schema:
 *   { name, coverage_pct, hallucinations, faithfulness, notes,
 *     wiki_chars, judge_model, ts, layer: "quality-wiki" }
 *
 * Judge failure-tolerant: if Ollama down or judge returns unparseable
 * JSON, emits `{failed: true, reason}` line and exits non-zero. Does not
 * mutate any persistent state — every run uses a fresh tmp DB.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyMigrations } from "../packages/compost-core/src/schema/migrator";
import { upsertPolicies } from "../packages/compost-core/src/policies/registry";
import { synthesizeWiki } from "../packages/compost-core/src/cognitive/wiki";
import { OllamaLLMService } from "../packages/compost-core/src/llm/ollama";
import { createHash } from "crypto";

if (process.env.COMPOST_BENCH_NETWORK !== "true") {
  process.stdout.write(
    JSON.stringify({
      name: "quality-wiki",
      skipped: true,
      reason: "COMPOST_BENCH_NETWORK != true",
    }) + "\n"
  );
  process.exit(0);
}

interface FactSpec {
  subject: string;
  predicate: string;
  object: string;
}

interface Fixture {
  name: string;
  topic: string;
  facts: FactSpec[];
  /** Statements the synthesized wiki MUST be derivable from the facts above. Used in the judge prompt to anchor what counts as faithful coverage. */
  gold_assertions: string[];
}

const FIXTURES: Fixture[] = [
  {
    name: "compost-architecture",
    topic: "compost",
    facts: [
      { subject: "compost", predicate: "is", object: "a local-first knowledge fusion system" },
      { subject: "compost", predicate: "uses", object: "SQLite WAL for the L0 provenance ledger" },
      { subject: "compost", predicate: "uses", object: "LanceDB for vector storage" },
      { subject: "compost", predicate: "exposes", object: "an MCP server with observe / query / ask tools" },
      { subject: "compost", predicate: "synthesizes", object: "L3 wiki pages from L2 facts via LLM" },
    ],
    gold_assertions: [
      "Compost is described as local-first",
      "SQLite is mentioned as the ledger storage",
      "LanceDB is mentioned for vectors",
      "MCP server exposure is mentioned",
      "L3 wiki synthesis from L2 facts is mentioned",
    ],
  },
  {
    name: "engram-constraints",
    topic: "engram",
    facts: [
      { subject: "engram", predicate: "is", object: "a persistent zero-LLM memory store for AI coding agents" },
      { subject: "engram", predicate: "enforces", object: "deterministic FTS5 retrieval on the recall hot path" },
      { subject: "engram", predicate: "supports", object: "six memory kinds including constraint and decision" },
      { subject: "engram", predicate: "must", object: "run independently without compost installed" },
    ],
    gold_assertions: [
      "Engram is described as zero-LLM on the recall path",
      "Deterministic FTS5 retrieval is mentioned",
      "Multiple memory kinds are mentioned",
      "Independence from Compost is mentioned",
    ],
  },
  {
    name: "quotaflow-purpose",
    topic: "quotaflow",
    facts: [
      { subject: "quotaflow", predicate: "is", object: "a local daemon for Claude Max token quota allocation" },
      { subject: "quotaflow", predicate: "predicts", object: "burn rate and projected exhaustion using P90 percentile" },
      { subject: "quotaflow", predicate: "warns", object: "before a costly agent task starts when budget is low" },
    ],
    gold_assertions: [
      "QuotaFlow is described as a local quota daemon",
      "Burn rate or P90 prediction is mentioned",
      "Pre-dispatch warning behavior is mentioned",
    ],
  },
];

const ITERS = Number(process.env.COMPOST_BENCH_QUALITY_ITERS ?? "1");
const JUDGE_MODEL = process.env.COMPOST_BENCH_JUDGE_MODEL ?? "gemma4:31b";

interface JudgeVerdict {
  coverage_pct: number;
  hallucinations: number;
  faithfulness: number;
  notes: string;
}

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function seedFixtureFacts(db: Database, fixture: Fixture): void {
  const sourceId = `bench-quality-${fixture.name}`;
  db.run(
    `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier)
     VALUES (?, ?, 'sensory', 'first_party')`,
    [sourceId, `sensory://${sourceId}`]
  );

  const insertObs = db.prepare(
    `INSERT INTO observations (
       observe_id, source_id, source_uri, occurred_at, captured_at,
       content_hash, raw_hash, mime_type, adapter, adapter_sequence,
       trust_tier, idempotency_key, transform_policy
     ) VALUES (?, ?, ?,
               datetime('now'), datetime('now'),
               ?, ?, 'text/plain', 'bench-quality', ?, 'first_party', ?, 'tp-2026-04')`
  );
  const insertFact = db.prepare(
    `INSERT INTO facts (fact_id, subject, predicate, object, confidence, importance, observe_id)
     VALUES (?, ?, ?, ?, 0.9, 0.6, ?)`
  );

  const tx = db.transaction(() => {
    fixture.facts.forEach((f, i) => {
      const obsId = `obs-q-${sha16(`${sourceId}-${i}`)}`;
      const factContent = `${f.subject} ${f.predicate} ${f.object}`;
      insertObs.run(
        obsId,
        sourceId,
        `sensory://${sourceId}/row/${i}`,
        sha16(factContent),
        sha16(factContent + "raw"),
        i,
        `idem-${obsId}`
      );
      const factId = `fact-q-${sha16(obsId + "-fact")}`;
      insertFact.run(factId, f.subject, f.predicate, f.object, obsId);
    });
  });
  tx();
}

function buildJudgePrompt(fixture: Fixture, wikiContent: string): string {
  const factLines = fixture.facts
    .map((f) => `- ${f.subject} | ${f.predicate} | ${f.object}`)
    .join("\n");
  const goldLines = fixture.gold_assertions.map((a, i) => `${i + 1}. ${a}`).join("\n");
  return `You are a strict evaluator of LLM-generated wiki content.

INPUT FACTS (the only ground truth, expressed as subject | predicate | object triples):
${factLines}

REQUIRED COVERAGE (the wiki must be derivable from the facts above for each of these gold assertions):
${goldLines}

GENERATED WIKI:
"""
${wikiContent}
"""

Score the generated wiki on three dimensions:
- coverage_pct (0-100): percentage of the gold assertions that are clearly stated or directly derivable from the wiki.
- hallucinations (integer >= 0): number of distinct factual claims in the wiki that are NOT derivable from the input facts. Style commentary and section headers do not count. Restating a fact in different words does not count.
- faithfulness (0-1): overall judgment of how truthful the wiki is to the input facts, where 1.0 = no contradictions and no unsupported additions, 0.0 = mostly invented.

Reply with ONLY a JSON object on a single line. No code fences, no commentary outside the JSON.

Schema:
{"coverage_pct": <int 0-100>, "hallucinations": <int>, "faithfulness": <float 0..1>, "notes": "<one short sentence>"}`;
}

function parseVerdict(raw: string): JudgeVerdict | null {
  const trimmed = raw.trim();
  // Try direct parse
  try {
    const obj = JSON.parse(trimmed);
    if (
      typeof obj.coverage_pct === "number" &&
      typeof obj.hallucinations === "number" &&
      typeof obj.faithfulness === "number"
    ) {
      return {
        coverage_pct: obj.coverage_pct,
        hallucinations: obj.hallucinations,
        faithfulness: obj.faithfulness,
        notes: typeof obj.notes === "string" ? obj.notes.slice(0, 200) : "",
      };
    }
  } catch {
    // fall through
  }
  // Try to extract first {...} block
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      return {
        coverage_pct: Number(obj.coverage_pct ?? 0),
        hallucinations: Number(obj.hallucinations ?? 0),
        faithfulness: Number(obj.faithfulness ?? 0),
        notes: typeof obj.notes === "string" ? obj.notes.slice(0, 200) : "",
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function benchOneFixture(
  fixture: Fixture,
  llm: OllamaLLMService,
  judge: OllamaLLMService
): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), `compost-bench-quality-${fixture.name}-`));
  const dbPath = join(dataDir, "ledger.db");

  try {
    const db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    upsertPolicies(db);
    seedFixtureFacts(db, fixture);

    await synthesizeWiki(db, llm, dataDir);

    const wikiPath = join(dataDir, "wiki", `${fixture.topic}.md`);
    if (!existsSync(wikiPath)) {
      const row = db
        .query(`SELECT path, content FROM wiki_pages WHERE title = ? LIMIT 1`)
        .get(fixture.topic) as { path: string; content: string } | undefined;
      if (!row) {
        db.close();
        process.stdout.write(
          JSON.stringify({
            name: `quality-wiki-${fixture.name}`,
            failed: true,
            reason: "no wiki page produced",
          }) + "\n"
        );
        return;
      }
      const verdict = await runJudge(judge, fixture, row.content);
      db.close();
      emit(fixture, verdict, row.content.length);
      return;
    }

    const wikiContent = readFileSync(wikiPath, "utf8");
    db.close();

    const samples: JudgeVerdict[] = [];
    for (let i = 0; i < ITERS; i++) {
      const verdict = await runJudge(judge, fixture, wikiContent);
      if (!verdict) {
        process.stdout.write(
          JSON.stringify({
            name: `quality-wiki-${fixture.name}`,
            failed: true,
            reason: "judge returned unparseable response",
          }) + "\n"
        );
        return;
      }
      samples.push(verdict);
    }

    // Average across iters (single-iter is the common case)
    const avg: JudgeVerdict = {
      coverage_pct:
        samples.reduce((a, b) => a + b.coverage_pct, 0) / samples.length,
      hallucinations:
        samples.reduce((a, b) => a + b.hallucinations, 0) / samples.length,
      faithfulness:
        samples.reduce((a, b) => a + b.faithfulness, 0) / samples.length,
      notes: samples[0]?.notes ?? "",
    };
    emit(fixture, avg, wikiContent.length);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function runJudge(
  judge: OllamaLLMService,
  fixture: Fixture,
  wikiContent: string
): Promise<JudgeVerdict | null> {
  const prompt = buildJudgePrompt(fixture, wikiContent);
  const raw = await judge.generate(prompt, {
    maxTokens: 256,
    temperature: 0.0,
    timeoutMs: 60_000,
  });
  return parseVerdict(raw);
}

function round(n: number, places: number = 2): number {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

function emit(fixture: Fixture, verdict: JudgeVerdict, wikiChars: number): void {
  process.stdout.write(
    JSON.stringify({
      name: `quality-wiki-${fixture.name}`,
      topic: fixture.topic,
      coverage_pct: round(verdict.coverage_pct),
      hallucinations: round(verdict.hallucinations),
      faithfulness: round(verdict.faithfulness, 3),
      notes: verdict.notes,
      wiki_chars: wikiChars,
      iters: ITERS,
      judge_model: JUDGE_MODEL,
      ts: new Date().toISOString(),
      git_sha: (process.env.GITHUB_SHA ?? "local").slice(0, 12),
      layer: "quality-wiki",
    }) + "\n"
  );
}

async function main(): Promise<void> {
  const llm = new OllamaLLMService();
  const judge = new OllamaLLMService({ model: JUDGE_MODEL });

  // Probe judge availability before running fixtures so a missing model
  // surfaces as one error instead of three.
  try {
    await judge.generate("ok", { maxTokens: 4, timeoutMs: 10_000 });
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        name: "quality-wiki",
        failed: true,
        reason: `judge unavailable: ${err instanceof Error ? err.message : String(err)}`,
        hint: "Is Ollama running and does it have the judge model? `ollama pull " + JUDGE_MODEL + "`",
      }) + "\n"
    );
    process.exit(1);
  }

  for (const fixture of FIXTURES) {
    try {
      await benchOneFixture(fixture, llm, judge);
    } catch (err) {
      process.stdout.write(
        JSON.stringify({
          name: `quality-wiki-${fixture.name}`,
          failed: true,
          reason: err instanceof Error ? err.message : String(err),
        }) + "\n"
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`bench quality failed: ${err}\n`);
  process.exit(1);
});
