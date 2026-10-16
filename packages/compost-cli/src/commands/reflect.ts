import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { reflect } from "../../../compost-core/src/cognitive/reflect";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

/** The sensory GC cascades through SQLite only; vectors are dropped here. */
async function dropVectors(observeIds: string[]): Promise<void> {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  const lanceDir = join(dir, "lancedb");
  if (!existsSync(lanceDir)) return;
  const { OllamaEmbeddingService } = await import("../../../compost-core/src/embedding/ollama");
  const { VectorStore } = await import("../../../compost-core/src/storage/lancedb");
  const store = new VectorStore(lanceDir, new OllamaEmbeddingService());
  await store.connect();
  try {
    await store.deleteByObserveIds(observeIds);
  } finally {
    await store.close();
  }
}

export function registerReflect(program: Command): void {
  program
    .command("reflect")
    .description("Manually trigger the reflection loop (active forgetting)")
    .action(async () => {
      const db = openDb();
      try {
        const report = reflect(db);
        if (report.sensoryObserveIdsDeleted.length > 0) {
          try {
            await dropVectors(report.sensoryObserveIdsDeleted);
          } catch (err) {
            report.errors.push({ step: "vectorGC", message: err instanceof Error ? err.message : String(err) });
          }
        }
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        if (report.errors.length) process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
