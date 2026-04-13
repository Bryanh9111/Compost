import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import { startDrainLoop, startReflectScheduler, startFreshnessLoop, startIngestWorker } from "./scheduler";
import type { Scheduler } from "./scheduler";
import { OllamaEmbeddingService } from "../../compost-core/src/embedding/ollama";
import { VectorStore } from "../../compost-core/src/storage/lancedb";
import pino from "pino";

const log = pino({ name: "compost-daemon" });

const DEFAULT_DATA_DIR = join(
  process.env["HOME"] ?? "/tmp",
  ".compost"
);

export interface DaemonHandle {
  db: Database;
  stop(): Promise<void>;
}

let _handle: DaemonHandle | null = null;

/**
 * Start the Compost daemon.
 *
 * @param dataDir - directory for ledger.db, daemon.pid, daemon.sock.
 *                  Defaults to ~/.compost. Pass a temp dir for tests.
 * @param withMcp  - whether to start the MCP stdio server. Default true.
 *                  Pass false in tests that don't need MCP.
 */
export async function startDaemon(
  dataDir: string = DEFAULT_DATA_DIR,
  withMcp = true
): Promise<DaemonHandle> {
  // 1. Ensure data directory (chmod 700)
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    log.info({ dataDir }, "created data directory");
  }

  // 2. Open SQLite
  const dbPath = join(dataDir, "ledger.db");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  // 3. Migrations + policies
  const migResult = applyMigrations(db);
  if (migResult.errors.length > 0) {
    log.error({ errors: migResult.errors }, "migration errors");
    throw new Error(`Migration failed: ${migResult.errors[0]?.error ?? "unknown"}`);
  }
  log.info({ applied: migResult.applied.length }, "migrations applied");

  upsertPolicies(db);
  log.info("policies upserted");

  // 4. Write PID file
  const pidPath = join(dataDir, "daemon.pid");
  writeFileSync(pidPath, String(process.pid), "utf-8");

  // 5. Initialize embedding + vector store
  const embSvc = new OllamaEmbeddingService();
  const vectorStore = new VectorStore(join(dataDir, "lancedb"), embSvc);
  try {
    await vectorStore.connect();
    log.info("vector store connected");
  } catch (err) {
    log.warn({ err }, "vector store connection failed (embedding will be skipped)");
  }

  // 6. Start background services
  const drainSched: Scheduler = startDrainLoop(db);
  const reflectSched: Scheduler = startReflectScheduler(db);
  const ingestSched: Scheduler = startIngestWorker(db, {
    embeddingService: embSvc,
    vectorStore,
    dataDir,
  });
  const freshnessSched: Scheduler = startFreshnessLoop(db, dataDir);

  // 7. Unix socket control server (stop/status/reload)
  const sockPath = join(dataDir, "daemon.sock");
  const socketServer = await startControlSocket(sockPath, db);

  // 8. MCP stdio server (skip in test environments that pass withMcp=false)
  let mcpHandle: { stop(): Promise<void> } | null = null;
  if (withMcp) {
    try {
      const { startMcpServer } = await import("./mcp-server");
      mcpHandle = await startMcpServer(db);
      log.info("MCP stdio server started");
    } catch (err) {
      log.warn({ err }, "MCP server failed to start (SDK may not be installed)");
    }
  }

  // 9. Signal handlers
  const cleanup = async () => {
    log.info("shutting down");
    drainSched.stop();
    reflectSched.stop();
    ingestSched.stop();
    freshnessSched.stop();
    socketServer.stop();
    if (mcpHandle) await mcpHandle.stop();
    await vectorStore.close().catch(() => {});
    tryUnlink(pidPath);
    tryUnlink(sockPath);
    db.close();
  };

  process.once("SIGTERM", () => void cleanup().then(() => process.exit(0)));
  process.once("SIGINT", () => void cleanup().then(() => process.exit(0)));

  const handle: DaemonHandle = {
    db,
    async stop() {
      await cleanup();
    },
  };

  _handle = handle;
  return handle;
}

/**
 * Stop the currently running daemon (if started in this process).
 */
export async function stopDaemon(): Promise<void> {
  if (_handle) {
    await _handle.stop();
    _handle = null;
  }
}

// ---------------------------------------------------------------------------
// Unix socket control server
// ---------------------------------------------------------------------------

interface SocketServer {
  stop(): void;
}

async function startControlSocket(
  sockPath: string,
  db: Database
): Promise<SocketServer> {
  // Remove stale socket
  tryUnlink(sockPath);

  let active = true;
  const server = Bun.listen<undefined>({
    unix: sockPath,
    socket: {
      data(_socket, data) {
        const cmd = data.toString().trim();
        log.debug({ cmd }, "control socket command");
        if (cmd === "stop") {
          void stopDaemon().then(() => process.exit(0));
        } else if (cmd === "status") {
          const info = { pid: process.pid, uptime: process.uptime() };
          _socket.write(JSON.stringify(info) + "\n");
        } else if (cmd === "reload") {
          try {
            upsertPolicies(db);
            _socket.write(JSON.stringify({ ok: true }) + "\n");
          } catch (err) {
            _socket.write(
              JSON.stringify({ ok: false, error: String(err) }) + "\n"
            );
          }
        } else {
          _socket.write(JSON.stringify({ error: "unknown command" }) + "\n");
        }
      },
      error(_socket, err) {
        log.error({ err }, "control socket error");
      },
      open(_socket) {
        log.debug("control socket client connected");
      },
      close(_socket) {
        log.debug("control socket client disconnected");
      },
    },
  });

  return {
    stop() {
      if (active) {
        active = false;
        server.stop(true);
      }
    },
  };
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore ENOENT
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  log.info({ dataDir }, "compost-daemon starting");
  await startDaemon(dataDir);
  log.info("compost-daemon ready");
}
