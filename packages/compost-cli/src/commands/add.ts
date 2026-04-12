import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../../compost-core/src/policies/registry";
import { ingestFile } from "../../../compost-core/src/pipeline/ingest";
import { ingestUrl } from "../../../compost-core/src/pipeline/web-ingest";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function isUrl(input: string): boolean {
  return input.startsWith("http://") || input.startsWith("https://");
}

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Ingest a local file or web URL into the ledger")
    .argument("<source>", "Path to file or URL to ingest")
    .action(async (source: string) => {
      const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
      if (!existsSync(dataDir))
        mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      const db = new Database(join(dataDir, "ledger.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      applyMigrations(db);
      upsertPolicies(db);

      // Set up embedding + vector store for full pipeline
      const { OllamaEmbeddingService } = await import(
        "../../../compost-core/src/embedding/ollama"
      );
      const { VectorStore } = await import(
        "../../../compost-core/src/storage/lancedb"
      );

      const embSvc = new OllamaEmbeddingService();
      const vectorStore = new VectorStore(join(dataDir, "lancedb"), embSvc);
      await vectorStore.connect();

      try {
        if (isUrl(source)) {
          const result = await ingestUrl(db, source, dataDir, {
            embeddingService: embSvc,
            vectorStore,
          });
          process.stdout.write(JSON.stringify(result) + "\n");
          process.exit(result.ok ? 0 : 1);
        } else {
          const result = await ingestFile(db, source, dataDir, {
            embeddingService: embSvc,
            vectorStore,
          });
          process.stdout.write(JSON.stringify(result) + "\n");
          process.exit(result.ok ? 0 : 1);
        }
      } finally {
        await vectorStore.close();
        db.close();
      }
    });
}
