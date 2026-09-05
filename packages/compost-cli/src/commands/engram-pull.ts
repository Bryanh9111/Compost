import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { backup } from "../../../compost-core/src/persistence/backup";
import { runEngramPullOnce } from "../../../compost-daemon/src/engram-poller";
import { CliEngramStreamClient } from "../../../compost-engram-adapter/src/cli-stream-client";
import { StreamPuller, type StreamCursor } from "../../../compost-engram-adapter/src/stream-puller";
import { VectorStore } from "../../../compost-core/src/storage/lancedb";
import { OllamaEmbeddingService } from "../../../compost-core/src/embedding/ollama";

export function registerEngramPull(program: Command): void {
  program.command("engram-pull")
    .description("Pull Engram memories and reconcile cached lifecycle state")
    .option("--engram-bin <path>", "Engram CLI binary", "engram")
    .option("--project <name>", "Filter by Engram project (requires a separate cursor)")
    .option("--kinds <kinds>", "Comma-separated Engram kinds")
    .option("--cursor-path <path>", "Cursor file path (default: data directory/engram-cursor.json)")
    .option("--dry-run", "Preview all matching entries without writing data or cursor", false)
    .option("--replay", "Back up ledger/cursor and replay available upstream history idempotently", false)
    .option("--no-embed", "Defer embeddings during recovery; keyword search remains available")
    .action(async (opts) => {
      const dir = process.env["COMPOST_DATA_DIR"] ?? join(process.env["HOME"] ?? "/tmp", ".compost");
      if ((opts.project || opts.kinds) && !opts.cursorPath) {
        throw new Error("Filtered pulls require --cursor-path to avoid advancing the unfiltered daemon cursor");
      }
      const cursorPath = opts.cursorPath ?? join(dir, "engram-cursor.json");
      const client = new CliEngramStreamClient({ engramBin: opts.engramBin });
      const filters = {
        ...(opts.project !== undefined ? { project: opts.project } : {}),
        ...(opts.kinds !== undefined ? { kinds: opts.kinds.split(",").map((k) => k.trim()).filter(Boolean) } : {}),
      };
      const puller = new StreamPuller(client, { cursorPath, ...filters });
      if (opts.dryRun) {
        let cursor: StreamCursor = opts.replay ? { since: null, last_memory_id: null } : puller.loadCursor();
        let entryCount = 0;
        while (true) {
          const batch = await puller.pullBatch({ cursor, limit: 1000 });
          entryCount += batch.entries.length;
          cursor = batch.cursor;
          if (batch.reached_end) break;
        }
        process.stdout.write(JSON.stringify({ mode: "dry-run", ok: true, entry_count: entryCount, last_cursor: cursor }) + "\n");
        return;
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const db = new Database(join(dir, "ledger.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
      let vectorStore: VectorStore | undefined;
      try {
        applyMigrations(db);
        if (opts.replay) {
          const recoveryDir = join(dir, "backups", `${Date.now()}-engram-replay`);
          backup(db, recoveryDir);
          if (existsSync(cursorPath)) copyFileSync(cursorPath, join(recoveryDir, "engram-cursor.json"));
          puller.saveCursor({ since: null, last_memory_id: null });
        }
        const embeddingService = new OllamaEmbeddingService();
        if (opts.embed) {
          vectorStore = new VectorStore(join(dir, "lancedb"), embeddingService);
          try { await vectorStore.connect(); }
          catch { await vectorStore.close(); vectorStore = undefined; }
        }
        const stats = await runEngramPullOnce(db, {
          client, cursorPath, ...filters,
          ...(vectorStore ? { embeddingService, vectorStore } : {}),
        });
        process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
        if (stats.errors.length) process.exitCode = 1;
      } finally {
        await vectorStore?.close();
        db.close();
      }
    });
}
