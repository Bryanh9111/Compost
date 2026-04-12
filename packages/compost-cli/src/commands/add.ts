import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../../compost-core/src/policies/registry";
import { ingestFile } from "../../../compost-core/src/pipeline/ingest";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Ingest a local file into the ledger")
    .argument("<file>", "Path to file to ingest")
    .action(async (file: string) => {
      const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
      if (!existsSync(dataDir))
        mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      const db = new Database(join(dataDir, "ledger.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      applyMigrations(db);
      upsertPolicies(db);

      try {
        const result = await ingestFile(db, file, dataDir);
        process.stdout.write(JSON.stringify(result) + "\n");
        process.exit(result.ok ? 0 : 1);
      } finally {
        db.close();
      }
    });
}
