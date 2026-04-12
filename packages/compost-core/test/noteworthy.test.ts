import { describe, test, expect } from "bun:test";
import { is_noteworthy, type NoteworthyInput } from "../src/ledger/noteworthy";

// ---------------------------------------------------------------------------
// Helpers — mirrors noteworthy.ts internal hashing so fixtures stay consistent
// ---------------------------------------------------------------------------

function sha256Hex(data: Uint8Array | string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

function makeSnapshot(rawBytes: Uint8Array, normalized: string) {
  return {
    rawHash: sha256Hex(rawBytes),
    normHash: sha256Hex(new TextEncoder().encode(normalized)),
    normalized,
  };
}

const DEFAULT_POLICY: NoteworthyInput["policy"] = {
  minhashJaccard: 0.97,
  embeddingCosine: 0.95,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("is_noteworthy", () => {
  // -------------------------------------------------------------------------
  // 1. first-seen: no prior snapshot → noteworthy=true
  // -------------------------------------------------------------------------
  test("first-seen: no prior snapshot", async () => {
    const raw = new TextEncoder().encode("Hello, world!");
    const result = await is_noteworthy({
      candidate: { rawBytes: raw, normalized: "Hello, world!" },
      priorSnapshot: undefined,
      policy: DEFAULT_POLICY,
    });

    expect(result.noteworthy).toBe(true);
    expect(result.reason).toBe("first-seen");
    expect(result.signals.rawHashDiff).toBe(true);
    expect(result.signals.normHashDiff).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. identical: same bytes → noteworthy=false, reason "byte-identical"
  // -------------------------------------------------------------------------
  test("identical: same bytes → byte-identical", async () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const raw = new TextEncoder().encode(text);
    const normalized = text;

    const result = await is_noteworthy({
      candidate: { rawBytes: raw, normalized },
      priorSnapshot: makeSnapshot(raw, normalized),
      policy: DEFAULT_POLICY,
    });

    expect(result.noteworthy).toBe(false);
    expect(result.reason).toBe("byte-identical");
    expect(result.signals.rawHashDiff).toBe(false);
    expect(result.signals.jaccard).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3. whitespace-only: raw differs, normalized same → noteworthy=false
  //    Prior: "hello   world"   (extra spaces)
  //    Candidate: "hello world" (single space)
  //    Both normalize to "hello world" after whitespace collapse.
  // -------------------------------------------------------------------------
  test("whitespace-only: raw differs, normalized same", async () => {
    const priorRaw = new TextEncoder().encode("hello   world");
    const normalized = "hello world"; // shared normalized form

    const candidateRaw = new TextEncoder().encode("hello world");

    const result = await is_noteworthy({
      candidate: { rawBytes: candidateRaw, normalized },
      priorSnapshot: makeSnapshot(priorRaw, normalized),
      policy: DEFAULT_POLICY,
    });

    expect(result.noteworthy).toBe(false);
    // Raw hashes differ (different bytes), but normalized hash is same
    expect(result.signals.rawHashDiff).toBe(true);
    expect(result.signals.normHashDiff).toBe(false);
    expect(result.reason).toBe("whitespace-normalized-identical");
  });

  // -------------------------------------------------------------------------
  // 4. comma-fix: normalized differs but jaccard >= 0.98 → noteworthy=false
  //    Two nearly-identical long texts that differ only by one comma.
  // -------------------------------------------------------------------------
  test("comma-fix: tiny punctuation diff → jaccard >= 0.98 → not noteworthy", async () => {
    // Build a long enough text so that a single comma change keeps jaccard high.
    // A 500-char text with one comma inserted/removed will have very high overlap.
    const base =
      "The project specification outlines the architecture for a distributed " +
      "content processing pipeline that ingests observations from multiple sources " +
      "and applies a series of transformations to extract structured knowledge " +
      "from unstructured text. The pipeline consists of several stages including " +
      "ingestion, normalization, deduplication, and enrichment phases. Each stage " +
      "is designed to be independently scalable and fault-tolerant ensuring that " +
      "the overall system remains robust under varying load conditions.";

    const priorNormalized = base;
    const candidateNormalized =
      "The project specification outlines the architecture for a distributed " +
      "content processing pipeline that ingests observations from multiple sources " +
      "and applies a series of transformations to extract structured knowledge " +
      "from unstructured text. The pipeline consists of several stages including " +
      "ingestion, normalization, deduplication, and enrichment phases. Each stage " +
      "is designed to be independently scalable and fault-tolerant, ensuring that " +
      "the overall system remains robust under varying load conditions.";
    // ^ only change: added comma after "fault-tolerant"

    const priorRaw = new TextEncoder().encode(priorNormalized);
    const candidateRaw = new TextEncoder().encode(candidateNormalized);

    const result = await is_noteworthy({
      candidate: { rawBytes: candidateRaw, normalized: candidateNormalized },
      priorSnapshot: makeSnapshot(priorRaw, priorNormalized),
      policy: DEFAULT_POLICY,
    });

    // normHash must differ (different strings)
    expect(result.signals.normHashDiff).toBe(true);
    // Jaccard should be >= 0.97 (high overlap on 5-shingles, policy threshold)
    expect(result.signals.jaccard).toBeGreaterThanOrEqual(0.97);
    expect(result.noteworthy).toBe(false);
    expect(result.reason).toBe("near-duplicate-jaccard");
  });

  // -------------------------------------------------------------------------
  // 5. new-paragraph: jaccard < 0.98 → noteworthy=true
  //    Add a substantial new paragraph (~20% new content).
  // -------------------------------------------------------------------------
  test("new-paragraph: jaccard < 0.98 → noteworthy=true", async () => {
    const priorNormalized =
      "The quick brown fox jumps over the lazy dog. " +
      "This is the first paragraph of the document. " +
      "It contains enough text to form meaningful five-character shingles.";

    const candidateNormalized =
      priorNormalized +
      " An entirely new paragraph has been added here with fresh content that " +
      "does not appear in the prior version. This new material introduces ideas " +
      "about distributed systems, consensus algorithms, and fault tolerance patterns " +
      "that were previously absent from the document.";

    const priorRaw = new TextEncoder().encode(priorNormalized);
    const candidateRaw = new TextEncoder().encode(candidateNormalized);

    const result = await is_noteworthy({
      candidate: { rawBytes: candidateRaw, normalized: candidateNormalized },
      priorSnapshot: makeSnapshot(priorRaw, priorNormalized),
      policy: DEFAULT_POLICY,
    });

    expect(result.signals.rawHashDiff).toBe(true);
    expect(result.signals.normHashDiff).toBe(true);
    expect(result.signals.jaccard).toBeLessThan(0.98);
    expect(result.noteworthy).toBe(true);
    expect(result.reason).toBe("content-changed");
  });

  // -------------------------------------------------------------------------
  // 6. complete-rewrite: jaccard < 0.5 → noteworthy=true
  // -------------------------------------------------------------------------
  test("complete-rewrite: jaccard < 0.5 → noteworthy=true", async () => {
    const priorNormalized =
      "Solar energy is a renewable resource that harnesses photons from the sun " +
      "to generate electricity through photovoltaic cells or concentrated solar power " +
      "systems. The efficiency of modern solar panels has improved dramatically over " +
      "the past two decades thanks to advances in semiconductor materials and " +
      "manufacturing techniques. Residential solar installations have become " +
      "increasingly affordable as costs continue to decline year over year.";

    const candidateNormalized =
      "Quantum computing leverages the principles of quantum mechanics including " +
      "superposition and entanglement to perform computations that would be " +
      "intractable for classical computers. Qubits can exist in multiple states " +
      "simultaneously allowing quantum algorithms to explore vast solution spaces " +
      "in parallel. Applications include cryptography, drug discovery, optimization " +
      "problems, and simulation of complex molecular systems.";

    const priorRaw = new TextEncoder().encode(priorNormalized);
    const candidateRaw = new TextEncoder().encode(candidateNormalized);

    const result = await is_noteworthy({
      candidate: { rawBytes: candidateRaw, normalized: candidateNormalized },
      priorSnapshot: makeSnapshot(priorRaw, priorNormalized),
      policy: DEFAULT_POLICY,
    });

    expect(result.signals.rawHashDiff).toBe(true);
    expect(result.signals.normHashDiff).toBe(true);
    expect(result.signals.jaccard).toBeLessThan(0.5);
    expect(result.noteworthy).toBe(true);
    expect(result.reason).toBe("content-changed");
  });
});
