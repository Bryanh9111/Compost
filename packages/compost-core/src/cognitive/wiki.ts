/**
 * L3 Wiki synthesizer — generates markdown wiki pages from L2 facts via LLM.
 * Writes to wiki_pages table + disk (~/.compost/wiki/).
 */
import type { Database } from "bun:sqlite";
import type { LLMService } from "../llm/types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

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
      `SELECT f.subject, f.predicate, f.object, f.confidence, f.created_at,
              o.source_uri
       FROM facts f
       JOIN observations o ON o.observe_id = f.observe_id
       WHERE f.subject = ? AND f.archived_at IS NULL
       ORDER BY f.confidence DESC, f.created_at DESC
       LIMIT 50`
    )
    .all(topic) as Array<{
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

  const markdown = await llm.generate(prompt, {
    maxTokens: 2048,
    temperature: 0.2,
    systemPrompt: "You are a precise, factual wiki page writer. Only use information from the provided facts.",
  });

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

  // Write to wiki_pages table
  if (existing) {
    db.run(
      `UPDATE wiki_pages SET title = ?, last_synthesis_at = datetime('now'), last_synthesis_model = ?
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

  return { created: !existing, updated: !!existing };
}

/**
 * Run wiki synthesis for all topics needing pages.
 * Called by reflect scheduler after reflect() completes.
 */
export async function synthesizeWiki(
  db: Database,
  llm: LLMService,
  dataDir: string
): Promise<WikiSynthesisResult> {
  const wikiDir = join(dataDir, "wiki");
  mkdirSync(wikiDir, { recursive: true });

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
