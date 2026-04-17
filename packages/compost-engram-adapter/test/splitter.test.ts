import { describe, test, expect } from "bun:test";
import {
  MAX_CONTENT_CHARS,
  ADJACENT_CHUNK_SIMILARITY_CEILING,
  computeRootInsightId,
  splitInsight,
  jaccardSimilarity,
  checkAdjacentSimilarity,
} from "../src";

const NOW = "2026-04-17T18:00:00Z";

describe("computeRootInsightId", () => {
  test("fact_ids order does not affect result", () => {
    const a = computeRootInsightId("compost", ["fact-c", "fact-a", "fact-b"]);
    const b = computeRootInsightId("compost", ["fact-a", "fact-b", "fact-c"]);
    expect(a).toBe(b);
  });

  test("different project yields different root id", () => {
    const a = computeRootInsightId("compost", ["f1", "f2"]);
    const b = computeRootInsightId("engram", ["f1", "f2"]);
    expect(a).not.toBe(b);
  });

  test("NULL project yields stable id distinct from named project", () => {
    const nullProject = computeRootInsightId(null, ["f1"]);
    const named = computeRootInsightId("anything", ["f1"]);
    expect(nullProject).not.toBe(named);
    expect(nullProject).toBe(computeRootInsightId(null, ["f1"]));
  });

  test("returns a valid UUID string", () => {
    const id = computeRootInsightId("p", ["f1"]);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe("splitInsight — single chunk path", () => {
  test("content <= MAX_CONTENT_CHARS returns one chunk with total=1", () => {
    const chunks = splitInsight({
      project: "compost",
      compostFactIds: ["f1"],
      content: "Short insight.",
      synthesizedAt: NOW,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].source_trace.total_chunks).toBe(1);
    expect(chunks[0].source_trace.chunk_index).toBe(0);
    expect(chunks[0].source_trace.split_strategy).toBe("none");
    expect(chunks[0].content).toBe("Short insight.");
  });

  test("optional fields only appear when provided", () => {
    const bare = splitInsight({
      project: "p",
      compostFactIds: ["f1"],
      content: "c",
      synthesizedAt: NOW,
    })[0];
    expect(bare.source_trace.compost_wiki_path).toBeUndefined();
    expect(bare.source_trace.derivation_run_id).toBeUndefined();

    const full = splitInsight({
      project: "p",
      compostFactIds: ["f1"],
      content: "c",
      synthesizedAt: NOW,
      compostWikiPath: "docs/wiki.md",
      derivationRunId: "run-42",
    })[0];
    expect(full.source_trace.compost_wiki_path).toBe("docs/wiki.md");
    expect(full.source_trace.derivation_run_id).toBe("run-42");
  });
});

describe("splitInsight — paragraph strategy", () => {
  test("content split on paragraph boundaries when paragraphs fit", () => {
    const para = "P".repeat(900);
    const content = [para, para, para].join("\n\n");
    expect(content.length).toBeGreaterThan(MAX_CONTENT_CHARS);

    const chunks = splitInsight({
      project: "p",
      compostFactIds: ["f1", "f2"],
      content,
      synthesizedAt: NOW,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
      expect(c.source_trace.split_strategy).toBe("paragraph");
    }
    // Shared identity
    const root = chunks[0].source_trace.root_insight_id;
    for (const c of chunks) {
      expect(c.source_trace.root_insight_id).toBe(root);
      expect(c.source_trace.total_chunks).toBe(chunks.length);
      expect(c.source_trace.synthesized_at).toBe(NOW);
    }
    // Sequential indices
    chunks.forEach((c, i) => expect(c.source_trace.chunk_index).toBe(i));
  });
});

describe("splitInsight — sentence strategy fallback", () => {
  test("single oversized paragraph falls back to sentence split", () => {
    // One paragraph larger than cap, but made of short sentences.
    const sentence = "Short sentence about topic " + "x".repeat(40) + ". ";
    const content = sentence.repeat(90); // ~6000+ chars, no \n\n
    expect(content.length).toBeGreaterThan(MAX_CONTENT_CHARS);
    expect(content.split(/\n\n+/).length).toBe(1);

    const chunks = splitInsight({
      project: "p",
      compostFactIds: ["f1"],
      content,
      synthesizedAt: NOW,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    }
    expect(chunks[0].source_trace.split_strategy).toBe("sentence");
  });
});

describe("splitInsight — hard-cut fallback", () => {
  test("content with no paragraph or sentence boundaries falls to hard-cut", () => {
    const content = "a".repeat(MAX_CONTENT_CHARS * 2 + 300);
    const chunks = splitInsight({
      project: "p",
      compostFactIds: ["f1"],
      content,
      synthesizedAt: NOW,
    });
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.content.length <= MAX_CONTENT_CHARS)).toBe(
      true
    );
    expect(chunks[0].source_trace.split_strategy).toBe("hard-cut");
  });
});

describe("jaccard / adjacency ceiling", () => {
  test("disjoint tokens → 0", () => {
    expect(jaccardSimilarity("alpha beta", "gamma delta")).toBe(0);
  });

  test("identical → 1", () => {
    expect(jaccardSimilarity("alpha beta", "alpha beta")).toBe(1);
  });

  test("partial overlap", () => {
    expect(jaccardSimilarity("a b c", "b c d")).toBeCloseTo(0.5, 5);
  });

  test("paragraph split on varied content produces adjacents below ceiling (R6)", () => {
    const p1 =
      "Compost observes facts from local markdown files. " +
      "Each observation gets a stable origin hash. " +
      "The hash ties provenance to the ingest method.";
    const p2 =
      "Engram stores personal memory as atomic claims. " +
      "Recall is zero-LLM with FTS5. " +
      "Proactive push surfaces relevant memory before edits.";
    const p3 =
      "Bidirectional integration writes insights back. " +
      "Invalidation uses fact_id reverse lookup. " +
      "Pinned compost entries are still invalidated.";
    // Pad to force a multi-chunk split.
    const content = [
      p1.repeat(5),
      p2.repeat(5),
      p3.repeat(5),
    ].join("\n\n");

    const chunks = splitInsight({
      project: "p",
      compostFactIds: ["f1"],
      content,
      synthesizedAt: NOW,
    });
    expect(chunks.length).toBeGreaterThan(1);
    const violations = checkAdjacentSimilarity(chunks);
    expect(violations).toEqual([]);
  });

  test("checkAdjacentSimilarity flags crafted high-similarity pairs", () => {
    // Verify the detector itself — craft chunks (not produced by splitInsight)
    // where adjacent content shares >= 0.75 of its tokens.
    const crafted = [
      {
        content: "alpha beta gamma delta epsilon zeta eta theta iota zeta",
        source_trace: {
          compost_fact_ids: ["f1"],
          root_insight_id: "00000000-0000-5000-8000-000000000000",
          chunk_index: 0,
          total_chunks: 2,
          split_strategy: "paragraph" as const,
          synthesized_at: NOW,
        },
      },
      {
        content: "alpha beta gamma delta epsilon zeta eta theta iota kappa",
        source_trace: {
          compost_fact_ids: ["f1"],
          root_insight_id: "00000000-0000-5000-8000-000000000000",
          chunk_index: 1,
          total_chunks: 2,
          split_strategy: "paragraph" as const,
          synthesized_at: NOW,
        },
      },
    ];
    const violations = checkAdjacentSimilarity(crafted);
    expect(violations.length).toBe(1);
    expect(violations[0].pair).toEqual([0, 1]);
    expect(violations[0].similarity).toBeGreaterThanOrEqual(
      ADJACENT_CHUNK_SIMILARITY_CEILING
    );
  });
});
