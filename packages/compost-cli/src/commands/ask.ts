import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { ask } from "../../../compost-core/src/query/ask";
import { BreakerRegistry } from "../../../compost-core/src/llm/breaker-registry";
import { OllamaLLMService } from "../../../compost-core/src/llm/ollama";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

export function registerAsk(program: Command): void {
  program
    .command("ask")
    .description(
      "Ask a question — synthesizes an answer via LLM over hybrid retrieval + wiki. Low-confidence answers feed the gap tracker (debate 023 Phase 7 pre-work)."
    )
    .argument("<question>", "Natural-language question")
    .option("-b, --budget <n>", "Max number of fact hits to consider", (v) => parseInt(v, 10), 10)
    .option(
      "--no-track-gap",
      "Disable gap logging for this ask (use for private / exploratory queries)"
    )
    .option(
      "--gap-threshold <n>",
      "Top-hit confidence floor below which an answer counts as a gap (default 0.4)",
      (v) => parseFloat(v)
    )
    .action(async (question: string, opts) => {
      const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      const db = new Database(join(dataDir, "ledger.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      applyMigrations(db);

      const { VectorStore } = await import(
        "../../../compost-core/src/storage/lancedb"
      );
      const { OllamaEmbeddingService } = await import(
        "../../../compost-core/src/embedding/ollama"
      );
      const embSvc = new OllamaEmbeddingService();
      const lanceDir = join(dataDir, "lancedb");
      let vectorStore;
      try {
        vectorStore = new VectorStore(lanceDir, embSvc);
        await vectorStore.connect();
      } catch {
        vectorStore = undefined;
      }

      const llmRegistry = new BreakerRegistry(new OllamaLLMService());

      const gapThreshold = opts.trackGap === false ? null : opts.gapThreshold;

      try {
        const result = await ask(
          db,
          question,
          llmRegistry,
          {
            budget: opts.budget,
            gapThreshold,
          },
          vectorStore
        );
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } finally {
        if (vectorStore) await vectorStore.close();
        db.close();
      }
    });
}
