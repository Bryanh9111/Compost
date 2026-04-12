/**
 * compost.ask — LLM-synthesized answers over query results + wiki pages.
 * Debate 8 consensus: ask = query() + wiki context + LLM synthesis.
 * NOT an independent retrieval path.
 */
import type { Database } from "bun:sqlite";
import type { VectorStore } from "../storage/lancedb";
import type { LLMService } from "../llm/types";
import { query, type QueryOptions, type QueryHit } from "./search";

export interface AskResult {
  answer: string;
  query_id: string;
  hits: QueryHit[];
  wiki_pages_used: string[];
}

export interface AskOptions extends QueryOptions {
  maxAnswerTokens?: number;
}

/**
 * Ask a question — retrieves relevant facts via hybrid query,
 * gathers wiki context, and synthesizes an answer via LLM.
 */
export async function ask(
  db: Database,
  question: string,
  llm: LLMService,
  opts: AskOptions = {},
  vectorStore?: VectorStore
): Promise<AskResult> {
  // Step 1: Retrieve via hybrid query (same path as compost.query)
  const queryResult = await query(db, question, { ...opts, budget: opts.budget ?? 10 }, vectorStore);

  // Step 2: Gather relevant wiki pages
  const wikiPages: Array<{ path: string; title: string }> = [];
  if (queryResult.hits.length > 0) {
    // Find wiki pages whose titles match any hit subjects
    const subjects = [...new Set(queryResult.hits.map((h) => h.fact.subject))];
    for (const subject of subjects.slice(0, 5)) {
      const page = db
        .query("SELECT path, title FROM wiki_pages WHERE title = ?")
        .get(subject) as { path: string; title: string } | null;
      if (page) wikiPages.push(page);
    }
  }

  // Step 3: Read wiki page content from disk
  const { readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const dataDir = process.env["COMPOST_DATA_DIR"] ?? join(process.env["HOME"] ?? "/tmp", ".compost");
  const wikiDir = join(dataDir, "wiki");

  const wikiContexts: string[] = [];
  for (const page of wikiPages) {
    const fullPath = join(wikiDir, page.path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      wikiContexts.push(`## Wiki: ${page.title}\n${content}`);
    }
  }

  // Step 4: Build LLM prompt
  const factContext = queryResult.hits
    .map((h) => `- ${h.fact.subject} ${h.fact.predicate} ${h.fact.object} (confidence: ${h.confidence})`)
    .join("\n");

  const wikiContext = wikiContexts.length > 0 ? `\n\nWiki pages:\n${wikiContexts.join("\n\n")}` : "";

  const prompt = `Answer the following question using ONLY the provided facts and wiki context. If the information is insufficient, say so. Cite specific facts when possible.

Question: ${question}

Facts:
${factContext || "(no relevant facts found)"}${wikiContext}

Answer:`;

  // Step 5: Generate answer
  let answer: string;
  if (queryResult.hits.length === 0 && wikiContexts.length === 0) {
    answer = "I don't have enough information in my knowledge base to answer this question.";
  } else {
    answer = await llm.generate(prompt, {
      maxTokens: opts.maxAnswerTokens ?? 1024,
      temperature: 0.2,
      systemPrompt: "You are a precise knowledge assistant. Only answer based on the provided facts and wiki context. Be concise.",
    });
  }

  return {
    answer,
    query_id: queryResult.query_id,
    hits: queryResult.hits,
    wiki_pages_used: wikiPages.map((p) => p.path),
  };
}
