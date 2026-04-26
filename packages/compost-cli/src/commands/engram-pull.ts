import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { runEngramPullOnce } from "../../../compost-daemon/src/engram-poller";
import { CliEngramStreamClient } from "../../../compost-engram-adapter/src/cli-stream-client";

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

export function registerEngramPull(program: Command): void {
  program
    .command("engram-pull")
    .description(
      "Manually pull Engram memories into Compost's ledger (Phase 5 Session 6 slice 1)"
    )
    .option("--engram-bin <path>", "Engram CLI binary", "engram")
    .option("--project <name>", "Filter by Engram project")
    .option(
      "--kinds <kinds>",
      "Comma-separated Engram kinds to pull (default: all)"
    )
    .option(
      "--cursor-path <path>",
      "Cursor file path",
      join(DEFAULT_DATA_DIR, "engram-cursor.json")
    )
    .option("--dry-run", "Print stats without writing to the ledger", false)
    .action(async (opts) => {
      const db = openDb();
      try {
        const client = new CliEngramStreamClient({ engramBin: opts.engramBin });

        if (opts.dryRun) {
          // In dry run we pull the first batch via the underlying client
          // directly, report counts, and do not advance cursor / ingest.
          const r = await client.streamForCompost({ limit: 1000 });
          const summary = {
            mode: "dry-run",
            ok: r.ok,
            entry_count: r.data?.length ?? 0,
            error: r.error ?? null,
          };
          process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
          return;
        }

        // Wire embedding services so new chunks land in LanceDB. Without
        // this the entries are SQLite/FTS5-visible only and ANN can't
        // surface them — flattens cross-project reasoning quality (R3
        // dogfound 2026-04-25). Graceful degradation if Ollama embed
        // service is unreachable: ingest-adapter swallows the embed
        // error and the chunk stays embedded_at IS NULL until backfill.
        const { VectorStore } = await import(
          "../../../compost-core/src/storage/lancedb"
        );
        const { OllamaEmbeddingService } = await import(
          "../../../compost-core/src/embedding/ollama"
        );
        const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
        const lanceDir = join(dataDir, "lancedb");
        const embSvc = new OllamaEmbeddingService();
        let vectorStore: import("../../../compost-core/src/storage/lancedb").VectorStore | undefined;
        try {
          vectorStore = new VectorStore(lanceDir, embSvc);
          await vectorStore.connect();
        } catch {
          vectorStore = undefined;
        }

        const pullOpts: {
          client: typeof client;
          cursorPath: string;
          kinds?: string[];
          project?: string | null;
          embeddingService?: typeof embSvc;
          vectorStore?: typeof vectorStore;
        } = {
          client,
          cursorPath: opts.cursorPath,
        };
        if (opts.project !== undefined) pullOpts.project = opts.project;
        if (opts.kinds !== undefined) {
          pullOpts.kinds = opts.kinds.split(",").map((k) => k.trim()).filter(
            (k) => k.length > 0
          );
        }
        if (vectorStore) {
          pullOpts.embeddingService = embSvc;
          pullOpts.vectorStore = vectorStore;
        }

        const stats = await runEngramPullOnce(db, pullOpts);
        process.stdout.write(JSON.stringify(stats, null, 2) + "\n");

        if (vectorStore) await vectorStore.close();
        if (stats.errors.length > 0) process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
