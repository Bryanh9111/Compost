import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import { startDrainLoop, startReflectScheduler, startFreshnessLoop, startReasoningScheduler, startIngestWorker, startBackupScheduler, startGraphHealthScheduler } from "./scheduler";
import type { Scheduler, SchedulerHealth } from "./scheduler";
import { OllamaEmbeddingService } from "../../compost-core/src/embedding/ollama";
import { VectorStore } from "../../compost-core/src/storage/lancedb";
import { OllamaLLMService } from "../../compost-core/src/llm/ollama";
import { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";
import { startEngramFlusher } from "./engram-flusher";
import { startEngramPoller } from "./engram-poller";
import type { EngramMcpClient } from "../../compost-engram-adapter/src/writer";
import type { EngramStreamClient } from "../../compost-engram-adapter/src/stream-puller";
import { PendingWritesQueue } from "../../compost-engram-adapter/src/pending-writes";
import { recoverStaleRuns } from "./recovery";
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

export interface RegisteredScheduler {
  name: string;
  scheduler: Scheduler;
}

/**
 * Engram bi-directional loop wiring. Production sets nothing and the
 * daemon auto-wires from env vars + stdio/CLI spawns; tests inject fake
 * clients to avoid spawning subprocesses. `disabled: true` short-circuits
 * both schedulers (HC-1 — daemon must boot without Engram).
 */
export interface DaemonEngramOpts {
  /**
   * Skip both engram-flusher and engram-poller. **Default true** — tests
   * and library callers never spawn subprocesses unless they opt in.
   * Set to `false` in the daemon binary entrypoint to auto-wire the
   * bidirectional loop; or pass `flusherMcpClient` / `pollerStreamClient`
   * to enable with injected clients (also flips default to enabled).
   */
  disabled?: boolean;
  /** Pre-constructed flusher MCP client (test injection). */
  flusherMcpClient?: EngramMcpClient;
  /** Pre-constructed poller stream client (test injection). */
  pollerStreamClient?: EngramStreamClient;
  /** Flusher cadence (ms). Default 5 minutes. */
  flushIntervalMs?: number;
  /** Poller cadence (ms). Default 5 minutes. */
  pollIntervalMs?: number;
  /** Pending writes SQLite path. Default ~/.compost/pending-engram-writes.db. */
  pendingWritesPath?: string;
  /** Cursor file path. Default <dataDir>/engram-cursor.json. */
  cursorPath?: string;
  /** engram-server stdio command for flusher auto-wire. Default env / "engram-server". */
  engramServerCmd?: string;
  /** engram-server stdio args for flusher auto-wire. Default []. */
  engramServerArgs?: string[];
  /** Engram CLI binary for poller auto-wire. Default env / "engram". */
  engramBin?: string;
}

let _handle: DaemonHandle | null = null;

/**
 * Start the Compost daemon.
 *
 * @param dataDir - directory for ledger.db, daemon.pid, daemon.sock.
 *                  Defaults to ~/.compost. Pass a temp dir for tests.
 * @param withMcp  - whether to start the MCP stdio server. Default true.
 *                  Pass false in tests that don't need MCP.
 * @param engramOpts - optional Engram integration config. See DaemonEngramOpts.
 */
export async function startDaemon(
  dataDir: string = DEFAULT_DATA_DIR,
  withMcp = true,
  engramOpts: DaemonEngramOpts = {}
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
  // Debate 009 Fix 1+2: construct one BreakerRegistry at daemon boot so the
  // reflect scheduler's wiki synthesis and any future callers share circuit
  // state per site. OllamaLLMService ctor is side-effect-free; connection
  // errors only surface on first generate() and are absorbed by the breaker.
  const llmRegistry = new BreakerRegistry(new OllamaLLMService());

  const drainSched: Scheduler = startDrainLoop(db);
  const reflectSched: Scheduler = startReflectScheduler(db, {
    llm: llmRegistry,
    dataDir,
  });
  try {
    recoverStaleRuns(db);
  } catch (err) {
    log.error({ err }, "stale derivation_run recovery failed (continuing)");
  }
  const ingestSched: Scheduler = startIngestWorker(db, {
    embeddingService: embSvc,
    vectorStore,
    dataDir,
  });
  const freshnessSched: Scheduler = startFreshnessLoop(db, dataDir);
  // Phase 7 L5 hybrid scheduler (debate 026). Independent timer (NOT coupled
  // to reflect): cycle picks recently-active subjects, runs runReasoning(),
  // verdict-feedback gates throttle on quality regression.
  const reasoningSched: Scheduler = startReasoningScheduler(
    db,
    llmRegistry,
    vectorStore
  );
  // P0-7 backup scheduler: daily 03:00 UTC SQLite VACUUM INTO + retention prune.
  // P0-3 graph-health scheduler: daily 04:00 UTC graph snapshot.
  // Both were previously exported but never wired in main.ts (dogfound 2026-04-27).
  const backupDir = join(dataDir, "backups");
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }
  const backupSched: Scheduler = startBackupScheduler(db, {
    ledgerPath: dbPath,
    backupDir,
  });
  const graphHealthSched: Scheduler = startGraphHealthScheduler(db);
  const schedulers: RegisteredScheduler[] = [
    { name: "drain", scheduler: drainSched },
    { name: "reflect", scheduler: reflectSched },
    { name: "ingest", scheduler: ingestSched },
    { name: "freshness", scheduler: freshnessSched },
    { name: "reasoning", scheduler: reasoningSched },
    { name: "backup", scheduler: backupSched },
    { name: "graph-health", scheduler: graphHealthSched },
  ];

  // 6a. Engram bi-directional loop schedulers. HC-1: daemon boots even
  // if Engram is unreachable — construction failures downgrade to warn.
  const engramState = await maybeStartEngramSchedulers(db, dataDir, engramOpts, {
    embeddingService: embSvc,
    vectorStore,
  });

  // 7. Unix socket control server (stop/status/reload)
  const sockPath = join(dataDir, "daemon.sock");
  const socketServer = await startControlSocket(sockPath, db, schedulers);

  // 8. MCP stdio server (skip in test environments that pass withMcp=false)
  let mcpHandle: { stop(): Promise<void> } | null = null;
  if (withMcp) {
    try {
      const { startMcpServer } = await import("./mcp-server");
      mcpHandle = await startMcpServer(db, llmRegistry);
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
    reasoningSched.stop();
    backupSched.stop();
    graphHealthSched.stop();
    engramState.flusher?.stop();
    engramState.poller?.stop();
    await engramState.shutdown().catch((err) => {
      log.warn({ err }, "engram shutdown error (continuing)");
    });
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
  db: Database,
  schedulers: RegisteredScheduler[] = []
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
          const info = {
            pid: process.pid,
            uptime: process.uptime(),
            schedulers: collectSchedulerHealth(schedulers),
          };
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

export function collectSchedulerHealth(schedulers: RegisteredScheduler[]): SchedulerHealth[] {
  return schedulers.map(({ name, scheduler }) => {
    try {
      return scheduler.getHealth();
    } catch (err) {
      log.error({ err, scheduler: name }, "scheduler health check failed");
      return {
        name,
        last_tick_at: null,
        error_count: 1,
        running: false,
      };
    }
  });
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore ENOENT
  }
}

// ---------------------------------------------------------------------------
// Engram scheduler wiring (T2 tech-debt fix: Phase 5 runtime-live for real)
// ---------------------------------------------------------------------------

interface EngramSchedulerState {
  flusher: { stop(): void | Promise<void> } | null;
  poller: { stop(): void | Promise<void> } | null;
  shutdown: () => Promise<void>;
}

const NOOP_SHUTDOWN: EngramSchedulerState = {
  flusher: null,
  poller: null,
  shutdown: async () => {},
};

async function maybeStartEngramSchedulers(
  db: Database,
  dataDir: string,
  engramOpts: DaemonEngramOpts,
  embedDeps: {
    embeddingService: OllamaEmbeddingService;
    vectorStore: VectorStore;
  }
): Promise<EngramSchedulerState> {
  // Per-scheduler opt-in. HC-1: tests/library callers never spawn
  // subprocesses by accident. CLI binary flips `disabled: false` to
  // auto-wire both from env defaults; tests inject whichever client they
  // exercise without accidentally triggering the other subprocess.
  const autoWireBoth = engramOpts.disabled === false;
  const runFlusher =
    autoWireBoth || engramOpts.flusherMcpClient !== undefined;
  const runPoller =
    autoWireBoth || engramOpts.pollerStreamClient !== undefined;
  if (!runFlusher && !runPoller) return NOOP_SHUTDOWN;

  // ------- Flusher (Compost -> Engram; MCP stdio) -------
  let flusherSched: { stop(): void | Promise<void> } | null = null;
  let flusherQueue: PendingWritesQueue | null = null;
  let flusherMcpClient = engramOpts.flusherMcpClient ?? null;
  let flusherOwnsClient = false;
  const flusherQueuePath =
    engramOpts.pendingWritesPath ??
    join(dataDir, "pending-engram-writes.db");

  if (runFlusher && flusherMcpClient === null) {
    // Auto-wire from env / defaults. Connect failure -> warn + skip.
    const cmd =
      engramOpts.engramServerCmd ??
      process.env["COMPOST_ENGRAM_SERVER_CMD"] ??
      "engram-server";
    const args =
      engramOpts.engramServerArgs ??
      splitEnvArgs(process.env["COMPOST_ENGRAM_SERVER_ARGS"]);
    try {
      const { createStdioMcpClient, StdioEngramMcpClient } = await import(
        "../../compost-engram-adapter/src/mcp-stdio-client"
      );
      const transport = await createStdioMcpClient({ command: cmd, args });
      flusherMcpClient = new StdioEngramMcpClient({ client: transport });
      flusherOwnsClient = true;
    } catch (err) {
      log.warn(
        { err, cmd, args },
        "engram-flusher connect failed (HC-1 degrade — daemon continues without flusher)"
      );
    }
  }

  if (runFlusher && flusherMcpClient !== null) {
    try {
      flusherQueue = new PendingWritesQueue(flusherQueuePath);
      const intervalMs =
        engramOpts.flushIntervalMs ??
        (Number.parseInt(
          process.env["COMPOST_ENGRAM_FLUSH_INTERVAL_MS"] ?? "",
          10
        ) ||
          300_000);
      flusherSched = startEngramFlusher({
        mcpClient: flusherMcpClient,
        queue: flusherQueue,
        intervalMs,
      });
      log.info({ intervalMs, flusherQueuePath }, "engram-flusher started");
    } catch (err) {
      log.warn({ err }, "engram-flusher startup failed — skipping");
      flusherQueue?.close();
      flusherQueue = null;
    }
  }

  // ------- Poller (Engram -> Compost; CLI spawn) -------
  let pollerSched: { stop(): void | Promise<void> } | null = null;
  const pollerClient = engramOpts.pollerStreamClient ?? null;
  const pollerBin =
    engramOpts.engramBin ?? process.env["COMPOST_ENGRAM_BIN"] ?? "engram";
  const cursorPath =
    engramOpts.cursorPath ?? join(dataDir, "engram-cursor.json");

  let effectivePollerClient = pollerClient;
  if (runPoller && effectivePollerClient === null) {
    try {
      const { CliEngramStreamClient } = await import(
        "../../compost-engram-adapter/src/cli-stream-client"
      );
      effectivePollerClient = new CliEngramStreamClient({
        engramBin: pollerBin,
      });
    } catch (err) {
      log.warn({ err }, "engram-poller client construction failed — skipping");
    }
  }

  if (runPoller && effectivePollerClient !== null) {
    try {
      const intervalMs =
        engramOpts.pollIntervalMs ??
        (Number.parseInt(
          process.env["COMPOST_ENGRAM_POLL_INTERVAL_MS"] ?? "",
          10
        ) ||
          300_000);
      pollerSched = startEngramPoller(db, {
        client: effectivePollerClient,
        intervalMs,
        cursorPath,
        embeddingService: embedDeps.embeddingService,
        vectorStore: embedDeps.vectorStore,
      });
      log.info({ intervalMs, cursorPath }, "engram-poller started");
    } catch (err) {
      log.warn({ err }, "engram-poller startup failed — skipping");
    }
  }

  return {
    flusher: flusherSched,
    poller: pollerSched,
    shutdown: async () => {
      if (flusherOwnsClient && flusherMcpClient) {
        // StdioEngramMcpClient exposes close() — only the auto-wired client
        // owns the transport, injected test clients remain caller-owned.
        const maybeCloseable = flusherMcpClient as unknown as {
          close?: () => Promise<void>;
        };
        if (typeof maybeCloseable.close === "function") {
          await maybeCloseable.close();
        }
      }
      flusherQueue?.close();
    },
  };
}

/** Split a shell-arg-ish env var by whitespace. No quoting; keep it simple. */
function splitEnvArgs(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(/\s+/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  log.info({ dataDir }, "compost-daemon starting");
  await startDaemon(dataDir, true, { disabled: false });
  log.info("compost-daemon ready");
}
