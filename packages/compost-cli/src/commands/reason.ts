import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  runReasoning,
  listRecentChains,
  getChainsBySeed,
  setVerdict,
  getVerdictStats,
  CHAIN_VERDICTS,
  type SeedKind,
  type ChainVerdict,
} from "../../../compost-core/src/cognitive/reasoning";
import { BreakerRegistry } from "../../../compost-core/src/llm/breaker-registry";
import { OllamaLLMService } from "../../../compost-core/src/llm/ollama";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

const VALID_SEED_KINDS: SeedKind[] = [
  "fact",
  "question",
  "gap",
  "curiosity_cluster",
];

function openDb(): Database {
  const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

export function registerReason(program: Command): void {
  const reason = program
    .command("reason")
    .description(
      "Phase 7 L5 — cross-fact reasoning. Hybrid retrieval + graph traversal + LLM-synthesized chain (debate 025)."
    );

  reason
    .command("run", { isDefault: true })
    .description("Run a reasoning chain over a seed (fact / question / gap / curiosity_cluster)")
    .argument("<seed>", "seed identifier (fact_id, question text, problem_id, or cluster representative id)")
    .option(
      "-k, --seed-kind <kind>",
      `seed kind (one of ${VALID_SEED_KINDS.join("/")})`,
      "fact"
    )
    .option("-t, --top-k <n>", "max candidates after RRF", (v) => parseInt(v, 10), 10)
    .option("-h, --graph-hops <n>", "graph traversal depth", (v) => parseInt(v, 10), 2)
    .option(
      "--no-link-writeback",
      "Skip the derived_from link write-back side-effect (debate 025 closed-loop opt-out)"
    )
    .option("--no-llm", "Skip LLM call entirely (dry-run; chain=null)")
    .option("--policy-version <s>", "override policy version (default l5-v1)")
    .option("--json", "machine-readable JSON output")
    .action(async (seed: string, opts) => {
      const seedKind = opts.seedKind as SeedKind;
      if (!VALID_SEED_KINDS.includes(seedKind)) {
        process.stderr.write(
          `error: invalid --seed-kind '${seedKind}'. Must be one of: ${VALID_SEED_KINDS.join(", ")}\n`
        );
        process.exit(2);
      }

      const db = openDb();
      const { VectorStore } = await import(
        "../../../compost-core/src/storage/lancedb"
      );
      const { OllamaEmbeddingService } = await import(
        "../../../compost-core/src/embedding/ollama"
      );
      const embSvc = new OllamaEmbeddingService();
      const lanceDir = join(
        process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR,
        "lancedb"
      );
      let vectorStore;
      try {
        vectorStore = new VectorStore(lanceDir, embSvc);
        await vectorStore.connect();
      } catch {
        vectorStore = undefined;
      }

      const llmRegistry = new BreakerRegistry(new OllamaLLMService());

      try {
        const chain = await runReasoning(
          db,
          { kind: seedKind, id: seed },
          llmRegistry,
          {
            topK: opts.topK,
            graphHops: opts.graphHops,
            noLinkWriteback: opts.linkWriteback === false,
            noLlm: opts.llm === false,
            policyVersion: opts.policyVersion,
          },
          vectorStore
        );

        if (opts.json) {
          process.stdout.write(JSON.stringify(chain, null, 2) + "\n");
        } else {
          process.stdout.write(formatChain(chain));
        }
      } finally {
        if (vectorStore) await vectorStore.close();
        db.close();
      }
    });

  reason
    .command("list")
    .description("List recent reasoning chains (newest first)")
    .option("-l, --limit <n>", "max chains to return", (v) => parseInt(v, 10), 20)
    .option("--json", "machine-readable JSON output")
    .action((opts) => {
      const db = openDb();
      try {
        const chains = listRecentChains(db, opts.limit);
        if (opts.json) {
          process.stdout.write(JSON.stringify(chains, null, 2) + "\n");
          return;
        }
        if (chains.length === 0) {
          process.stdout.write("(no reasoning chains)\n");
          return;
        }
        for (const c of chains) {
          process.stdout.write(formatChainSummary(c) + "\n");
        }
      } finally {
        db.close();
      }
    });

  reason
    .command("verdict")
    .description(
      "Stamp a user verdict on a reasoning chain (debate 026 entry signal — ground-truth feedback channel)."
    )
    .argument("<chain_id>", "chain_id (UUIDv5 from reason run/list)")
    .argument(
      "<verdict>",
      `verdict (one of ${CHAIN_VERDICTS.join("/")})`
    )
    .option("-n, --note <text>", "optional free-text note explaining the judgment")
    .option("--json", "machine-readable JSON output")
    .action((chainId: string, verdictArg: string, opts) => {
      if (!CHAIN_VERDICTS.includes(verdictArg as ChainVerdict)) {
        process.stderr.write(
          `error: invalid verdict '${verdictArg}'. Must be one of: ${CHAIN_VERDICTS.join(", ")}\n`
        );
        process.exit(2);
      }
      const db = openDb();
      try {
        const ok = setVerdict(
          db,
          chainId,
          verdictArg as ChainVerdict,
          opts.note ?? null
        );
        if (!ok) {
          process.stderr.write(`error: chain_id not found: ${chainId}\n`);
          process.exit(1);
        }
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ chain_id: chainId, verdict: verdictArg, note: opts.note ?? null }) + "\n"
          );
        } else {
          process.stdout.write(
            `verdict recorded: ${chainId.slice(0, 8)} → ${verdictArg}` +
              (opts.note ? ` (${opts.note})` : "") +
              "\n"
          );
        }
      } finally {
        db.close();
      }
    });

  reason
    .command("stats")
    .description(
      "Verdict-aggregate stats. Surfaces debate 026 entry-condition progress and LLM self-confidence calibration health."
    )
    .option("--json", "machine-readable JSON output")
    .action((opts) => {
      const db = openDb();
      try {
        const stats = getVerdictStats(db);
        if (opts.json) {
          process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
          return;
        }
        const fmt = (n: number | null) => (n === null ? "n/a" : n.toFixed(2));
        process.stdout.write(
          [
            `chains:           ${stats.total}  (unjudged: ${stats.unjudged})`,
            `verdicts:         confirmed=${stats.confirmed}  refined=${stats.refined}  rejected=${stats.rejected}`,
            `positive_rate:    ${(stats.positive_rate * 100).toFixed(1)}%  (confirmed+refined / judged)`,
            `mean confidence:  confirmed=${fmt(stats.mean_confidence_confirmed)}  rejected=${fmt(stats.mean_confidence_rejected)}`,
            "",
            stats.mean_confidence_confirmed !== null &&
            stats.mean_confidence_rejected !== null &&
            stats.mean_confidence_confirmed <= stats.mean_confidence_rejected
              ? "[!] calibration warning: LLM confidence on rejected chains >= confirmed. Prompt needs another pass."
              : "",
          ]
            .filter(Boolean)
            .join("\n") + "\n"
        );
      } finally {
        db.close();
      }
    });

  reason
    .command("show")
    .description("Show all reasoning chains for a given seed")
    .argument("<seed>", "seed identifier")
    .option(
      "-k, --seed-kind <kind>",
      `seed kind (one of ${VALID_SEED_KINDS.join("/")})`,
      "fact"
    )
    .option("--json", "machine-readable JSON output")
    .action((seed: string, opts) => {
      const seedKind = opts.seedKind as SeedKind;
      const db = openDb();
      try {
        const chains = getChainsBySeed(db, seedKind, seed, "any");
        if (opts.json) {
          process.stdout.write(JSON.stringify(chains, null, 2) + "\n");
          return;
        }
        if (chains.length === 0) {
          process.stdout.write(`(no chains for ${seedKind}=${seed})\n`);
          return;
        }
        for (const c of chains) {
          process.stdout.write(formatChain(c) + "\n");
        }
      } finally {
        db.close();
      }
    });
}

function formatChainSummary(c: {
  chain_id: string;
  seed_kind: string;
  seed_id: string;
  confidence: number;
  candidate_fact_ids: string[];
  status: string;
  answer: { chain: string | null; failure_reason?: string };
  created_at: string;
}): string {
  const head = `[${c.status}] ${c.chain_id.slice(0, 8)} ${c.seed_kind}=${c.seed_id.slice(0, 32)}`;
  const meta = `  conf=${c.confidence.toFixed(2)} candidates=${c.candidate_fact_ids.length} at=${c.created_at}`;
  const body = c.answer.chain
    ? `  chain: ${c.answer.chain.slice(0, 120)}${c.answer.chain.length > 120 ? "…" : ""}`
    : `  (no chain) ${c.answer.failure_reason ?? ""}`;
  return [head, meta, body].join("\n");
}

function formatChain(c: {
  chain_id: string;
  seed_kind: string;
  seed_id: string;
  policy_version: string;
  confidence: number;
  status: string;
  candidate_fact_ids: string[];
  retrieval_trace: { ann_count: number; graph_count: number; graph_hops: number; rrf_top_k: number };
  edge_refs: Array<{ from: string; to: string; kind: string }> | null;
  answer: { chain: string | null; failure_reason?: string; llm_meta?: { model: string } };
  reused_existing: boolean;
}): string {
  const lines = [
    `chain_id:        ${c.chain_id}${c.reused_existing ? " (reused)" : ""}`,
    `seed:            ${c.seed_kind}=${c.seed_id}`,
    `policy_version:  ${c.policy_version}`,
    `status:          ${c.status}  confidence=${c.confidence.toFixed(2)}`,
    `retrieval:       ann=${c.retrieval_trace.ann_count} graph=${c.retrieval_trace.graph_count} hops=${c.retrieval_trace.graph_hops} top_k=${c.retrieval_trace.rrf_top_k}`,
    `candidates (${c.candidate_fact_ids.length}): ${c.candidate_fact_ids.join(", ")}`,
  ];
  if (c.edge_refs && c.edge_refs.length > 0) {
    lines.push(
      `edge_refs (${c.edge_refs.length}): ${c.edge_refs
        .map((e) => `${e.from.slice(0, 8)} -[${e.kind}]-> ${e.to.slice(0, 8)}`)
        .join(", ")}`
    );
  }
  if (c.answer.chain) {
    lines.push("", "chain:", c.answer.chain);
  } else {
    lines.push("", `(no chain) failure_reason=${c.answer.failure_reason ?? "n/a"}`);
  }
  if (c.answer.llm_meta?.model) {
    lines.push(`llm_meta:        model=${c.answer.llm_meta.model}`);
  }
  return lines.join("\n") + "\n";
}
