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

export function registerReflect(program: Command): void {
  program
    .command("reflect")
    .description("Manually trigger the reflection loop (active forgetting)")
    .action(() => {
      const db = openDb();
      try {
        const report = reflect(db);
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } finally {
        db.close();
      }
    });
}
