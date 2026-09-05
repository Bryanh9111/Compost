import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  searchIndexStatus,
  rebuildSearchIndexes,
} from "../../../compost-core/src/query/search-index";

export function registerIndexes(program: Command) {
  program
    .command("indexes")
    .description(
      "Verify lexical index coverage and freshness; optionally rebuild derived indexes",
    )
    .option(
      "--rebuild",
      "Atomically rebuild keyword and Chinese indexes from source records",
    )
    .action((opts) => {
      const dir = process.env.COMPOST_DATA_DIR ?? join(homedir(), ".compost");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const db = new Database(join(dir, "ledger.db"));
      try {
        const migrated = applyMigrations(db);
        if (migrated.errors.length)
          throw new Error(`Migration failed: ${migrated.errors[0]?.error}`);
        const report = opts.rebuild
          ? rebuildSearchIndexes(db)
          : searchIndexStatus(db);
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        if (!report.ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
