/**
 * compost.ask — LLM-synthesized answers over query results + wiki pages.
 * Debate 8 consensus: ask = query() + wiki context + LLM synthesis.
 * Debate 9: added multi-query expansion (LLM generates query variants before search).
 * NOT an independent retrieval path.
 */
import type { Database } from "bun:sqlite";
import type { VectorStore } from "../storage/lancedb";
import type { LLMService } from "../llm/types";
import { BreakerRegistry } from "../llm/breaker-registry";
import { query, type QueryOptions, type QueryHit, type QueryResult } from "./search";

export interface AskResult {
  answer: string;
  query_id: string;
  hits: QueryHit[];
  wiki_pages_used: string[];
  expanded_queries?: string[];
}

export interface AskOptions extends QueryOptions {
  maxAnswerTokens?: number;
  expandQueries?: boolean; // default true — LLM generates 2-3 query variants
}

const EXPANSION_PROMPT = `Given the user's question, generate 2-3 alternative phrasings that could find relevant information. Return ONLY a JSON array of strings, no explanation.

Question: `;

/**
 * Expand a query into multiple variants using LLM.
 * Returns [original, ...variants]. Gracefully falls back to [original].
 */
async function expandQuery(question: string, llm: LLMService): Promise<string[]> {
  try {
    const raw = await llm.generate(EXPANSION_PROMPT + question, {
      maxTokens: 200,
      temperature: 0.3,
      timeoutMs: 10_000,
    });

    const text = raw.trim();
    // Strip markdown fences
    const cleaned = text.replace(/```\w*\n?/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const variants = JSON.parse(cleaned.slice(start, end + 1)) as string[];
      if (Array.isArray(variants) && variants.length > 0) {
        return [question, ...variants.slice(0, 3).filter((v) => typeof v === "string" && v.trim())];
      }
    }
  } catch (err) {
    // Expansion failure is non-fatal; log for operator visibility (debate 010
    // Fix 4). Distinguishes CircuitOpenError from genuine LLM 5xx so SRE can
    // tell "breaker is open" from "Ollama is actually broken".
    const name = err instanceof Error ? err.name : "unknown";
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`ask.expandQuery: LLM failure (${name}): ${msg}`);
  }
  return [question];
}

/**
 * Ask a question — retrieves relevant facts via hybrid query,
 * gathers wiki context, and synthesizes an answer via LLM.
 *
 * `llmOrRegistry` accepts either a raw `LLMService` (test / simple caller
 * path) or a `BreakerRegistry` (production path, debate 009 Fix 1). When a
 * registry is supplied, expansion uses `registry.get("ask.expand")` and
 * answer synthesis uses `registry.get("ask.answer")`, so a storm of failed
 * expansions cannot open the breaker that guards the main answer path.
 */
export async function ask(
  db: Database,
  question: string,
  llmOrRegistry: LLMService | BreakerRegistry,
  opts: AskOptions = {},
  vectorStore?: VectorStore
): Promise<AskResult> {
  const doExpand = opts.expandQueries !== false;
  const budget = opts.budget ?? 10;

  const expandLLM =
    llmOrRegistry instanceof BreakerRegistry
      ? llmOrRegistry.get("ask.expand")
      : llmOrRegistry;
  const answerLLM =
    llmOrRegistry instanceof BreakerRegistry
      ? llmOrRegistry.get("ask.answer")
      : llmOrRegistry;

  // Step 1: Multi-query expansion (Debate 9: ask-only, not compost.query)
  let queries = [question];
  if (doExpand) {
    queries = await expandQuery(question, expandLLM);
  }

  // Step 2: Fan-out search across all query variants, deduplicate by fact_id
  const seenFactIds = new Set<string>();
  const allHits: QueryHit[] = [];
  let primaryQueryId = "";

  for (const q of queries) {
    const result = await query(db, q, { ...opts, budget }, vectorStore);
    if (!primaryQueryId) primaryQueryId = result.query_id;
    for (const hit of result.hits) {
      if (!seenFactIds.has(hit.fact_id)) {
        seenFactIds.add(hit.fact_id);
        allHits.push(hit);
      }
    }
  }

  // Re-sort by final_score and limit to budget
  allHits.sort((a, b) => b.final_score - a.final_score);
  const queryResult: QueryResult = {
    query_id: primaryQueryId,
    hits: allHits.slice(0, budget),
    ranking_profile_id: opts.ranking_profile_id ?? "rp-phase3-default",
    budget,
  };

  // Step 2: Gather relevant wiki pages
  // P0-6 Lock 6: include stale_at so ask can warn the user when the wiki
  // hasn't been refreshed (breaker was open at last rebuild attempt).
  const wikiPages: Array<{ path: string; title: string; stale_at: string | null }> = [];
  if (queryResult.hits.length > 0) {
    // Find wiki pages whose titles match any hit subjects
    const subjects = [...new Set(queryResult.hits.map((h) => h.fact.subject))];
    for (const subject of subjects.slice(0, 5)) {
      const page = db
        .query("SELECT path, title, stale_at FROM wiki_pages WHERE title = ?")
        .get(subject) as { path: string; title: string; stale_at: string | null } | null;
      if (page) wikiPages.push(page);
    }
  } else {
    // Week 4 Day 5 + debate 013 F5: hits=0 path must still surface a wiki
    // page if the user's question slug matches one. Use the SAME slug
    // regex as wiki.ts:120 so multi-word questions like "Paris France"
    // resolve to "paris-france.md" instead of silently missing.
    const titleSlug = question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (titleSlug.length > 0) {
      const page = db
        .query(
          "SELECT path, title, stale_at FROM wiki_pages " +
            "WHERE LOWER(title) = ? OR LOWER(path) = ? " +
            "ORDER BY last_synthesis_at DESC " +
            "LIMIT 1"
        )
        .get(titleSlug, titleSlug + ".md") as
        | { path: string; title: string; stale_at: string | null }
        | null;
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
      const staleBanner = page.stale_at
        ? `> \u26A0\ufe0f [stale wiki: last refresh attempt failed at ${page.stale_at} UTC]\n\n`
        : "";
      wikiContexts.push(`## Wiki: ${page.title}\n${staleBanner}${content}`);
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
    // P0-6 fallback contract (ARCHITECTURE.md LLM call sites): on circuit
    // open / LLM error, return the top BM25 facts as plain text with an
    // `[LLM unavailable]` banner so the user still gets something usable.
    try {
      answer = await answerLLM.generate(prompt, {
        maxTokens: opts.maxAnswerTokens ?? 1024,
        temperature: 0.2,
        systemPrompt: "You are a precise knowledge assistant. Only answer based on the provided facts and wiki context. Be concise.",
      });
    } catch (err) {
      // Debate 010 Fix 4: surface LLM failure reason in operator log before
      // returning the BM25 fallback. Without this, a CircuitOpenError looks
      // identical to a genuine Ollama 5xx from the user's perspective.
      const name = err instanceof Error ? err.name : "unknown";
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`ask.answer: LLM failure (${name}): ${msg} -- returning BM25 fallback`);
      const bm25Fallback = queryResult.hits
        .slice(0, 10)
        .map(
          (h, i) =>
            `${i + 1}. ${h.fact.subject} ${h.fact.predicate} ${h.fact.object} (confidence: ${h.confidence.toFixed(2)})`
        )
        .join("\n");
      answer =
        `[LLM unavailable — returning top-${Math.min(10, queryResult.hits.length)} facts by relevance]\n\n` +
        (bm25Fallback || "(no relevant facts found)");
    }
  }

  return {
    answer,
    query_id: queryResult.query_id,
    hits: queryResult.hits,
    wiki_pages_used: wikiPages.map((p) => p.path),
    expanded_queries: queries.length > 1 ? queries : undefined,
  };
}
