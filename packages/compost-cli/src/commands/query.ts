import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { query } from "../../../compost-core/src/query/search";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

export function registerQuery(program: Command): void {
  program
    .command("query")
    .description("Query the knowledge base")
    .argument("<text>", "Query text")
    .action(async (text: string) => {
      const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      const db = new Database(join(dataDir, "ledger.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      applyMigrations(db);

      // Connect vector store for hybrid search
      const { OllamaEmbeddingService } = await import(
        "../../../compost-core/src/embedding/ollama"
      );
      const { VectorStore } = await import(
        "../../../compost-core/src/storage/lancedb"
      );

      const embSvc = new OllamaEmbeddingService();
      const lanceDir = join(dataDir, "lancedb");
      let vectorStore;
      try {
        vectorStore = new VectorStore(lanceDir, embSvc);
        await vectorStore.connect();
      } catch {
        vectorStore = undefined; // BM25-only fallback
      }

      try {
        const result = await query(db, text, {}, vectorStore);
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } finally {
        if (vectorStore) await vectorStore.close();
        db.close();
      }
    });
}
