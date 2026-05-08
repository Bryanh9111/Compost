import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { appendToOutbox, drainOne } from "../../compost-core/src/ledger/outbox";
import { query } from "../../compost-core/src/query/search";
import { reflect } from "../../compost-core/src/cognitive/reflect";
import { formatDaemonStatus, registerDaemon } from "../src/commands/daemon";
import { registerAdd } from "../src/commands/add";
import { registerQuery } from "../src/commands/query";
import { registerDoctor } from "../src/commands/doctor";
import { registerHook } from "../src/commands/hook";
import { registerReflect } from "../src/commands/reflect";
import { registerDrain } from "../src/commands/drain";
import { registerCapture } from "../src/commands/capture";
import { registerCover } from "../src/commands/cover";
import { registerRoute } from "../src/commands/route";
import { registerDid } from "../src/commands/did";
import { registerReconcile } from "../src/commands/reconcile";
import { registerPatterns } from "../src/commands/patterns";
import type { ReflectionReport } from "../../compost-core/src/cognitive/reflect";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestDir(): string {
  const dir = join(tmpdir(), `compost-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function openTestDb(dir: string): Database {
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

function buildProgram(): Command {
  const program = new Command()
    .name("compost")
    .version("0.1.0")
    .exitOverride(); // prevents process.exit in tests

  registerDaemon(program);
  registerAdd(program);
  registerQuery(program);
  registerDoctor(program);
  registerHook(program);
  registerReflect(program);
  registerDrain(program);
  registerCapture(program);
  registerCover(program);
  registerRoute(program);
  registerDid(program);
  registerReconcile(program);
  registerPatterns(program);
  return program;
}

// ---------------------------------------------------------------------------
// Commander structure tests
// ---------------------------------------------------------------------------

describe("CLI program structure", () => {
  it("has all expected top-level subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("daemon");
    expect(names).toContain("add");
    expect(names).toContain("query");
    expect(names).toContain("doctor");
    expect(names).toContain("hook");
    expect(names).toContain("reflect");
    expect(names).toContain("drain");
    expect(names).toContain("capture");
    expect(names).toContain("cover");
    expect(names).toContain("route");
    expect(names).toContain("did");
    expect(names).toContain("reconcile");
    expect(names).toContain("patterns");
  });

  it("cover has metacognitive audit options", () => {
    const program = buildProgram();
    const cover = program.commands.find((c) => c.name() === "cover");
    expect(cover).toBeDefined();
    const optionNames = cover!.options.map((o) => o.long);
    expect(optionNames).toContain("--project");
    expect(optionNames).toContain("--since-days");
    expect(optionNames).toContain("--repo-root");
    expect(optionNames).toContain("--no-docs");
    expect(optionNames).toContain("--json");
  });

  it("route has artifact routing options", () => {
    const program = buildProgram();
    const route = program.commands.find((c) => c.name() === "route");
    expect(route).toBeDefined();
    const optionNames = route!.options.map((o) => o.long);
    expect(optionNames).toContain("--project");
    expect(optionNames).toContain("--since-days");
    expect(optionNames).toContain("--repo-root");
    expect(optionNames).toContain("--no-docs");
    expect(optionNames).toContain("--json");
  });

  it("did has action timeline options", () => {
    const program = buildProgram();
    const did = program.commands.find((c) => c.name() === "did");
    expect(did).toBeDefined();
    const optionNames = did!.options.map((o) => o.long);
    expect(optionNames).toContain("--project");
    expect(optionNames).toContain("--source");
    expect(optionNames).toContain("--limit");
    expect(optionNames).toContain("--now");
    expect(optionNames).toContain("--json");
  });

  it("reconcile has action pointer audit options", () => {
    const program = buildProgram();
    const reconcile = program.commands.find((c) => c.name() === "reconcile");
    expect(reconcile).toBeDefined();
    const optionNames = reconcile!.options.map((o) => o.long);
    expect(optionNames).toContain("--project");
    expect(optionNames).toContain("--source");
    expect(optionNames).toContain("--limit");
    expect(optionNames).toContain("--issue-limit");
    expect(optionNames).toContain("--now");
    expect(optionNames).toContain("--json");
  });

  it("patterns has read-only action pattern options", () => {
    const program = buildProgram();
    const patterns = program.commands.find((c) => c.name() === "patterns");
    expect(patterns).toBeDefined();
    const optionNames = patterns!.options.map((o) => o.long);
    expect(optionNames).toContain("--project");
    expect(optionNames).toContain("--source");
    expect(optionNames).toContain("--limit");
    expect(optionNames).toContain("--pattern-limit");
    expect(optionNames).toContain("--now");
    expect(optionNames).toContain("--json");
  });

  it("capture has zsh subcommand", () => {
    const program = buildProgram();
    const capture = program.commands.find((c) => c.name() === "capture");
    expect(capture).toBeDefined();
    const sub = capture!.commands.map((c) => c.name());
    expect(sub).toContain("zsh");
    expect(sub).toContain("git");
    expect(sub).toContain("obsidian");
  });

  it("daemon has start/stop/status/reload subcommands", () => {
    const program = buildProgram();
    const daemon = program.commands.find((c) => c.name() === "daemon");
    expect(daemon).toBeDefined();
    const sub = daemon!.commands.map((c) => c.name());
    expect(sub).toContain("start");
    expect(sub).toContain("stop");
    expect(sub).toContain("status");
    expect(sub).toContain("reload");

    const start = daemon!.commands.find((c) => c.name() === "start");
    expect(start).toBeDefined();
    expect(start!.options.map((o) => o.long)).toContain("--with-mcp");
  });

  it("formats daemon status with scheduler health", () => {
    const output = formatDaemonStatus({
      pid: 12345,
      uptime: 100.2,
      schedulers: [
        {
          name: "ingest",
          last_tick_at: "2026-04-27T13:30:00Z",
          error_count: 0,
          running: true,
        },
        {
          name: "reflect",
          last_tick_at: null,
          error_count: 2,
          running: false,
        },
      ],
    });

    expect(output).toContain("pid: 12345  uptime: 100s");
    expect(output).toContain("schedulers:");
    expect(output).toContain("ingest");
    expect(output).toContain("[running]");
    expect(output).toContain("last_tick=2026-04-27T13:30:00Z");
    expect(output).toContain("reflect");
    expect(output).toContain("[stopped]");
    expect(output).toContain("last_tick=never");
    expect(output).toContain("errors=2");
  });

  it("doctor has diagnostic and LLM probe options", () => {
    const program = buildProgram();
    const doctor = program.commands.find((c) => c.name() === "doctor");
    expect(doctor).toBeDefined();
    const optionNames = doctor!.options.map((o) => o.long);
    expect(optionNames).toContain("--reconcile");
    expect(optionNames).toContain("--measure-hook");
    expect(optionNames).toContain("--drain-retry");
    expect(optionNames).toContain("--check-llm");
    expect(optionNames).toContain("--ollama-url");
    expect(optionNames).toContain("--llm-model");
    expect(optionNames).toContain("--llm-timeout-ms");
    expect(optionNames).toContain("--strict-llm");
  });

  it("drain has --adapter option", () => {
    const program = buildProgram();
    const drain = program.commands.find((c) => c.name() === "drain");
    expect(drain).toBeDefined();
    const optionNames = drain!.options.map((o) => o.long);
    expect(optionNames).toContain("--adapter");
  });
});

// ---------------------------------------------------------------------------
// add command
// ---------------------------------------------------------------------------

describe("add command", () => {
  let testDir: string;
  let tmpFile: string;

  beforeEach(() => {
    testDir = makeTestDir();
    process.env["COMPOST_DATA_DIR"] = testDir;
    tmpFile = join(testDir, "note.md");
    writeFileSync(tmpFile, "# Hello\n\nThis is a test note.");
  });

  afterEach(() => {
    delete process.env["COMPOST_DATA_DIR"];
    rmSync(testDir, { recursive: true, force: true });
  });

  it("ingests a markdown file and writes an observation", () => {
    const db = openTestDb(testDir);
    const content = "# Hello\n\nThis is a test note.";

    const sha256hex = (s: string) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(s);
      return hasher.digest("hex");
    };

    const idempotencyKey = sha256hex(`local-file:${tmpFile}:${content}`);
    const now = new Date().toISOString();

    appendToOutbox(db, {
      adapter: "local-file",
      source_id: tmpFile,
      source_kind: "local-file",
      source_uri: `file://${tmpFile}`,
      idempotency_key: idempotencyKey,
      trust_tier: "user",
      transform_policy: "default",
      payload: JSON.stringify({
        content,
        mime_type: "text/plain",
        occurred_at: now,
        metadata: { filename: "note.md" },
      }),
    });

    const result = drainOne(db);
    expect(result).not.toBeNull();
    expect(result!.observe_id).toBeString();

    const row = db
      .query("SELECT observe_id FROM observations LIMIT 1")
      .get() as { observe_id: string } | null;
    expect(row).not.toBeNull();
    expect(row!.observe_id).toBeString();

    db.close();
  });
});

// ---------------------------------------------------------------------------
// query command
// ---------------------------------------------------------------------------

describe("query command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
    process.env["COMPOST_DATA_DIR"] = testDir;
  });

  afterEach(() => {
    delete process.env["COMPOST_DATA_DIR"];
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty array of hits (no vectorStore)", async () => {
    const db = openTestDb(testDir);
    const result = await query(db, "what is a kernel?");
    expect(result.hits).toEqual([]);
    expect(result.query_id).toBeString();
    db.close();
  });

  it("returns correct QueryResult shape", async () => {
    const db = openTestDb(testDir);
    const result = await query(db, "test query");
    expect(typeof result.query_id).toBe("string");
    expect(Array.isArray(result.hits)).toBe(true);
    expect(typeof result.ranking_profile_id).toBe("string");
    expect(typeof result.budget).toBe("number");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// reflect command
// ---------------------------------------------------------------------------

describe("reflect command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
    process.env["COMPOST_DATA_DIR"] = testDir;
  });

  afterEach(() => {
    delete process.env["COMPOST_DATA_DIR"];
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns ReflectionReport shape", () => {
    const db = openTestDb(testDir);
    const report: ReflectionReport = reflect(db);

    // Verify all required fields
    expect(typeof report.sensoryObservationsDeleted).toBe("number");
    expect(typeof report.sensoryFactsCascaded).toBe("number");
    expect(typeof report.semanticFactsTombstoned).toBe("number");
    expect(typeof report.outboxRowsPruned).toBe("number");
    expect(typeof report.skippedDueToFkViolation).toBe("number");
    expect(typeof report.reflectionDurationMs).toBe("number");
    expect(Array.isArray(report.errors)).toBe(true);

    db.close();
  });

  it("runs without errors on empty db", () => {
    const db = openTestDb(testDir);
    const report = reflect(db);
    expect(report.errors).toHaveLength(0);
    expect(report.reflectionDurationMs).toBeGreaterThanOrEqual(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// doctor --reconcile
// ---------------------------------------------------------------------------

describe("doctor --reconcile", () => {
  it("counts observations and facts correctly on empty db", () => {
    const dir = makeTestDir();
    const db = openTestDb(dir);

    const obsRow = db
      .query("SELECT COUNT(*) AS c FROM observations")
      .get() as { c: number };
    const factRow = db
      .query("SELECT COUNT(*) AS c FROM facts")
      .get() as { c: number };

    expect(obsRow.c).toBe(0);
    expect(factRow.c).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// hook command (unit — direct outbox write)
// ---------------------------------------------------------------------------

describe("hook command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
    process.env["COMPOST_DATA_DIR"] = testDir;
  });

  afterEach(() => {
    delete process.env["COMPOST_DATA_DIR"];
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes to outbox without error", () => {
    const db = openTestDb(testDir);

    const sha256hex = (s: string) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(s);
      return hasher.digest("hex");
    };

    const adapter = "claude-code";
    const event = "session-start";
    const sourceId = `${adapter}:${event}`;
    const content = JSON.stringify({ session_id: "test-123" });
    const idempotencyKey = sha256hex(`${adapter}:${sourceId}:${content}`);
    const now = new Date().toISOString();

    appendToOutbox(db, {
      adapter,
      source_id: sourceId,
      source_kind: "claude-code",
      source_uri: `claude-code://${event}`,
      idempotency_key: idempotencyKey,
      trust_tier: "first_party",
      transform_policy: "default",
      payload: JSON.stringify({
        content,
        mime_type: "application/json",
        occurred_at: now,
        metadata: { hook_event: event },
      }),
    });

    const row = db
      .query("SELECT seq FROM observe_outbox LIMIT 1")
      .get() as { seq: number } | null;
    expect(row).not.toBeNull();
    expect(row!.seq).toBeGreaterThan(0);

    db.close();
  });

  it("is idempotent on duplicate events", () => {
    const db = openTestDb(testDir);

    const sha256hex = (s: string) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(s);
      return hasher.digest("hex");
    };

    const adapter = "claude-code";
    const event = "session-start";
    const sourceId = `${adapter}:${event}`;
    const content = JSON.stringify({ session_id: "dup-test" });
    const idempotencyKey = sha256hex(`${adapter}:${sourceId}:${content}`);
    const now = new Date().toISOString();

    const ev = {
      adapter,
      source_id: sourceId,
      source_kind: "claude-code" as const,
      source_uri: `claude-code://${event}`,
      idempotency_key: idempotencyKey,
      trust_tier: "first_party" as const,
      transform_policy: "default",
      payload: JSON.stringify({
        content,
        mime_type: "application/json",
        occurred_at: now,
        metadata: { hook_event: event },
      }),
    };

    appendToOutbox(db, ev);
    appendToOutbox(db, ev); // duplicate

    const count = db
      .query("SELECT COUNT(*) AS c FROM observe_outbox")
      .get() as { c: number };
    expect(count.c).toBe(1);

    db.close();
  });
});
