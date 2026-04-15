/**
 * L3 Wiki synthesizer — generates markdown wiki pages from L2 facts via LLM.
 * Writes to wiki_pages table + disk (~/.compost/wiki/).
 */
import type { Database } from "bun:sqlite";
import type { LLMService } from "../llm/types";
import { BreakerRegistry } from "../llm/breaker-registry";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { recordDecision, TIER_FOR_KIND, CONFIDENCE_FLOORS } from "./audit";
import { CircuitOpenError } from "../llm/circuit-breaker";

export interface WikiSynthesisResult {
  pages_created: number;
  pages_updated: number;
  topics: string[];
}

/**
 * Discover topics that have facts but no wiki page, or stale wiki pages.
 * Debate 9 fix: also watches archived_at changes (tombstoned facts should
 * trigger rebuild so the wiki doesn't show stale info).
 */
function findTopicsNeedingSynthesis(db: Database): string[] {
  const rows = db
    .query(
      `SELECT DISTINCT f.subject AS topic
       FROM facts f
       WHERE f.archived_at IS NULL
         AND f.superseded_by IS NULL
         AND f.subject NOT IN (
           SELECT wp.title FROM wiki_pages wp
           WHERE wp.last_synthesis_at > (
             SELECT MAX(COALESCE(f2.archived_at, f2.created_at)) FROM facts f2
             WHERE f2.subject = wp.title
           )
         )
       ORDER BY f.created_at DESC
       LIMIT 20`
    )
    .all() as Array<{ topic: string }>;

  return rows.map((r) => r.topic);
}

/**
 * Synthesize a single wiki page for a topic from its facts.
 */
async function synthesizePage(
  db: Database,
  topic: string,
  llm: LLMService,
  wikiDir: string
): Promise<{ created: boolean; updated: boolean }> {
  // Gather all active facts for this topic
  const facts = db
    .query(
      `SELECT f.fact_id, f.subject, f.predicate, f.object, f.confidence, f.created_at,
              o.source_uri
       FROM facts f
       JOIN observations o ON o.observe_id = f.observe_id
       WHERE f.subject = ? AND f.archived_at IS NULL
       ORDER BY f.confidence DESC, f.created_at DESC
       LIMIT 50`
    )
    .all(topic) as Array<{
      fact_id: string;
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
      created_at: string;
      source_uri: string;
    }>;

  if (facts.length === 0) return { created: false, updated: false };

  // Build prompt
  const factLines = facts
    .map((f) => `- ${f.subject} ${f.predicate} ${f.object} (confidence: ${f.confidence}, source: ${f.source_uri})`)
    .join("\n");

  const prompt = `You are a knowledge base wiki writer. Synthesize the following facts about "${topic}" into a clear, concise markdown wiki page. Include a title heading, organize information logically, and cite sources where relevant. Do not add information not present in the facts.

Facts:
${factLines}

Write the wiki page in markdown:`;

  let markdown: string;
  try {
    markdown = await llm.generate(prompt, {
      maxTokens: 2048,
      temperature: 0.2,
      systemPrompt: "You are a precise, factual wiki page writer. Only use information from the provided facts.",
    });
  } catch (err) {
    // P0-6 fallback (debate 007 Lock 6): circuit breaker open or direct LLM
    // failure. Keep the existing on-disk page (if any) but mark the wiki_pages
    // row as stale so ask.ts reads the stale banner. Don't write a
    // decision_audit row for a non-rebuild; this is not a real decision.
    const safePath = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const pagePath = `${safePath}.md`;
    const existing = db
      .query("SELECT path FROM wiki_pages WHERE path = ?")
      .get(pagePath) as { path: string } | null;
    if (existing) {
      db.run(
        "UPDATE wiki_pages SET stale_at = datetime('now') WHERE path = ?",
        [pagePath]
      );
    }
    const isCircuit = err instanceof CircuitOpenError;
    // Swallow -- caller continues with the next topic. Throw-on-fatal only
    // if the error is unknown (preserves prior exit semantics on bugs).
    if (!isCircuit && !(err instanceof Error)) throw err;
    return { created: false, updated: false };
  }

  // Write to disk
  const safePath = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pagePath = `${safePath}.md`;
  const fullPath = join(wikiDir, pagePath);
  mkdirSync(dirname(fullPath), { recursive: true });

  // Version snapshot: save existing content before overwrite
  const existing = db
    .query("SELECT path FROM wiki_pages WHERE path = ?")
    .get(pagePath) as { path: string } | null;

  if (existing && existsSync(fullPath)) {
    const oldContent = readFileSync(fullPath, "utf-8");
    db.run(
      `INSERT INTO wiki_page_versions (page_path, content, synthesis_model)
       VALUES (?, ?, (SELECT last_synthesis_model FROM wiki_pages WHERE path = ?))`,
      [pagePath, oldContent, pagePath]
    );
  }

  writeFileSync(fullPath, markdown, "utf-8");

  // Write to wiki_pages table. On successful rebuild, clear stale_at so
  // ask.ts stops prefixing the stale banner.
  if (existing) {
    db.run(
      `UPDATE wiki_pages SET title = ?, last_synthesis_at = datetime('now'),
         last_synthesis_model = ?, stale_at = NULL
       WHERE path = ?`,
      [topic, llm.model, pagePath]
    );
  } else {
    db.run(
      `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model)
       VALUES (?, ?, datetime('now'), ?)`,
      [pagePath, topic, llm.model]
    );
  }

  // Link wiki page to source observations via wiki_page_observe
  const observeIds = db
    .query(
      `SELECT DISTINCT f.observe_id FROM facts f
       WHERE f.subject = ? AND f.archived_at IS NULL`
    )
    .all(topic) as Array<{ observe_id: string }>;

  const insertWpo = db.prepare(
    "INSERT OR IGNORE INTO wiki_page_observe (page_path, observe_id, linked_at) VALUES (?, ?, datetime('now'))"
  );
  for (const row of observeIds) {
    insertWpo.run(pagePath, row.observe_id);
  }

  // P0-2 (Week 3): record wiki_rebuild audit row. Shape locked by debate 008
  // Q5: evidence references `input_fact_ids`, not observe_ids.
  //
  // Debate 009 Fix 3: audit is observability. At this point disk + wiki_pages
  // are already written; if recordDecision throws, surface via console.warn
  // so the daemon log captures it but don't propagate and abort synthesis.
  try {
    recordDecision(db, {
      kind: "wiki_rebuild",
      targetId: pagePath,
      confidenceTier: TIER_FOR_KIND.wiki_rebuild,
      confidenceActual: CONFIDENCE_FLOORS[TIER_FOR_KIND.wiki_rebuild],
      rationale: `${existing ? "updated" : "created"} wiki page for topic "${topic}" from ${facts.length} facts`,
      evidenceRefs: {
        kind: "wiki_rebuild",
        page_path: pagePath,
        input_fact_ids: facts.map((f) => f.fact_id),
        input_fact_count: facts.length,
      },
      decidedBy: "wiki",
    });
  } catch (auditErr) {
    console.warn(
      `wiki.synthesizePage: audit write failed for ${pagePath}:`,
      auditErr instanceof Error ? auditErr.message : String(auditErr)
    );
  }

  return { created: !existing, updated: !!existing };
}

/**
 * Run wiki synthesis for all topics needing pages.
 * Called by reflect scheduler after reflect() completes.
 *
 * `llmOrRegistry` accepts either a raw `LLMService` (test / simple caller
 * path) or a `BreakerRegistry` (production path, debate 009 Fix 1). With a
 * registry, synthesis uses `registry.get("wiki.synthesis")` so repeated
 * synthesis failures open the wiki breaker without starving `ask.answer`.
 */
export async function synthesizeWiki(
  db: Database,
  llmOrRegistry: LLMService | BreakerRegistry,
  dataDir: string
): Promise<WikiSynthesisResult> {
  const wikiDir = join(dataDir, "wiki");
  mkdirSync(wikiDir, { recursive: true });

  const llm =
    llmOrRegistry instanceof BreakerRegistry
      ? llmOrRegistry.get("wiki.synthesis")
      : llmOrRegistry;

  const topics = findTopicsNeedingSynthesis(db);
  let pagesCreated = 0;
  let pagesUpdated = 0;

  for (const topic of topics) {
    const { created, updated } = await synthesizePage(db, topic, llm, wikiDir);
    if (created) pagesCreated++;
    if (updated) pagesUpdated++;
  }

  return {
    pages_created: pagesCreated,
    pages_updated: pagesUpdated,
    topics,
  };
}
