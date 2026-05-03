import type { EmbeddingService } from "../embedding/types";
import type { VectorStore } from "../storage/lancedb";

/**
 * is_noteworthy — five-gate content change detector.
 *
 * Gate 1: raw byte hash (sha256 of rawBytes)
 * Gate 2: normalized string hash (sha256 of normalized)
 * Gate 3: MinHash Jaccard on 5-shingles (threshold from policy)
 * Gate 4: embedding cosine similarity on raw chunks (Phase 1)
 * Gate 5: novel fact count from post-extraction diff (Phase 1)
 */

export interface NoteworthyInput {
  candidate: { rawBytes: Uint8Array; normalized: string; chunks?: string[] };
  priorSnapshot?: {
    rawHash: string;
    normHash: string;
    normalized: string;
  };
  policy: { minhashJaccard: number; embeddingCosine: number };
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
  /** Post-extraction: how many new facts were produced vs prior */
  newFactCount?: number;
}

export interface NoteworthyResult {
  noteworthy: boolean;
  reason: string;
  signals: {
    rawHashDiff: boolean;
    normHashDiff: boolean;
    jaccard: number;
    novelChunkRatio: number;
    newFactCount: number;
  };
}

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------

function sha256Hex(data: Uint8Array | string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

// ---------------------------------------------------------------------------
// MinHash Jaccard estimation on 5-character shingles
// ---------------------------------------------------------------------------

const MINHASH_PERMUTATIONS = 128;
// Large prime for universal hash family a*x + b mod p
const LARGE_PRIME = 4294967311n; // > 2^32
const MAX_HASH = 0xffffffffn;

function shingle5(text: string): Set<number> {
  const shingles = new Set<number>();
  for (let i = 0; i <= text.length - 5; i++) {
    // FNV-1a 32-bit for fast shingling
    let h = 2166136261;
    for (let j = 0; j < 5; j++) {
      h ^= text.charCodeAt(i + j);
      h = (h * 16777619) >>> 0;
    }
    shingles.add(h);
  }
  return shingles;
}

// Precompute (a, b) pairs for 128 hash functions once per module load
const _permParams: Array<[bigint, bigint]> = (() => {
  const params: Array<[bigint, bigint]> = [];
  // Deterministic seed using CryptoHasher
  for (let i = 0; i < MINHASH_PERMUTATIONS; i++) {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(`minhash-a-${i}`);
    const aHex = hasher.digest("hex").slice(0, 8);
    const hasher2 = new Bun.CryptoHasher("sha256");
    hasher2.update(`minhash-b-${i}`);
    const bHex = hasher2.digest("hex").slice(0, 8);
    params.push([BigInt("0x" + aHex), BigInt("0x" + bHex)]);
  }
  return params;
})();

function computeMinHashSignature(shingles: Set<number>): number[] {
  const sig = new Array<number>(MINHASH_PERMUTATIONS).fill(0xffffffff);
  for (const shingle of shingles) {
    const x = BigInt(shingle >>> 0);
    for (let i = 0; i < MINHASH_PERMUTATIONS; i++) {
      const [a, b] = _permParams[i]!;
      const h = Number((a * x + b) % LARGE_PRIME % (MAX_HASH + 1n));
      if (h < sig[i]!) sig[i] = h;
    }
  }
  return sig;
}

export function estimateJaccardFromMinHash(
  setA: Set<number>,
  setB: Set<number>
): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const sigA = computeMinHashSignature(setA);
  const sigB = computeMinHashSignature(setB);

  let matches = 0;
  for (let i = 0; i < MINHASH_PERMUTATIONS; i++) {
    if (sigA[i] === sigB[i]) matches++;
  }
  return matches / MINHASH_PERMUTATIONS;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function is_noteworthy(
  input: NoteworthyInput
): Promise<NoteworthyResult> {
  const { candidate, priorSnapshot, policy } = input;

  // First-seen: no prior snapshot
  if (!priorSnapshot) {
    return {
      noteworthy: true,
      reason: "first-seen",
      signals: {
        rawHashDiff: true,
        normHashDiff: true,
        jaccard: 0,
        novelChunkRatio: 1,
        newFactCount: 0,
      },
    };
  }

  // Gate 1: raw byte hash
  const candidateRawHash = sha256Hex(candidate.rawBytes);
  const rawHashDiff = candidateRawHash !== priorSnapshot.rawHash;

  if (!rawHashDiff) {
    return {
      noteworthy: false,
      reason: "byte-identical",
      signals: {
        rawHashDiff: false,
        normHashDiff: false,
        jaccard: 1,
        novelChunkRatio: 0,
        newFactCount: 0,
      },
    };
  }

  // Gate 2: normalized hash
  const candidateNormHash = sha256Hex(
    new TextEncoder().encode(candidate.normalized)
  );
  const normHashDiff = candidateNormHash !== priorSnapshot.normHash;

  if (!normHashDiff) {
    return {
      noteworthy: false,
      reason: "whitespace-normalized-identical",
      signals: {
        rawHashDiff: true,
        normHashDiff: false,
        jaccard: 1,
        novelChunkRatio: 0,
        newFactCount: 0,
      },
    };
  }

  // Gate 3: MinHash Jaccard on 5-shingles
  const shinglesCandidate = shingle5(candidate.normalized);
  const shinglesPrior = shingle5(priorSnapshot.normalized);
  const jaccard = estimateJaccardFromMinHash(shinglesCandidate, shinglesPrior);

  const threshold = policy.minhashJaccard ?? 0.98;

  if (jaccard >= threshold) {
    return {
      noteworthy: false,
      reason: "near-duplicate-jaccard",
      signals: {
        rawHashDiff: true,
        normHashDiff: true,
        jaccard,
        novelChunkRatio: 0,
        newFactCount: 0,
      },
    };
  }

  // Gate 4: Embedding cosine similarity on raw chunks (Phase 1)
  // If embedding service + vector store are available, check if candidate chunks
  // are semantically novel compared to existing indexed content.
  let novelChunkRatio = 1.0; // default: all novel if no embedding
  if (input.embeddingService && input.vectorStore && input.candidate.chunks && input.candidate.chunks.length > 0) {
    const cosineThreshold = policy.embeddingCosine ?? 0.985;
    const embeddings = await input.embeddingService.embed(input.candidate.chunks);

    let novelCount = 0;
    for (const vec of embeddings) {
      const hits = await input.vectorStore.searchByVector(vec, 1);
      if (hits.length === 0 || hits[0]!.score < cosineThreshold) {
        novelCount++;
      }
    }
    novelChunkRatio = novelCount / input.candidate.chunks.length;

    // If no novel chunks, the content change is cosmetic
    if (novelChunkRatio < 0.05) {
      return {
        noteworthy: false,
        reason: "semantic-duplicate",
        signals: {
          rawHashDiff: true,
          normHashDiff: true,
          jaccard,
          novelChunkRatio,
          newFactCount: input.newFactCount ?? 0,
        },
      };
    }
  }

  // Gate 5: Novel fact count (post-extraction, if available)
  const newFactCount = input.newFactCount ?? 0;

  return {
    noteworthy: true,
    reason: novelChunkRatio < 1.0 ? "partial-novelty" : "content-changed",
    signals: {
      rawHashDiff: true,
      normHashDiff: true,
      jaccard,
      novelChunkRatio,
      newFactCount,
    },
  };
}
