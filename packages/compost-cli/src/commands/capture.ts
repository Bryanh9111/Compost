import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appendToOutbox } from "../../../compost-core/src/ledger/outbox";
import type { OutboxEvent } from "../../../compost-core/src/ledger/outbox";
import { upsertPolicies } from "../../../compost-core/src/policies/registry";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { scrub } from "../../../compost-hook-shim/src/pii";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");
const ZSH_ADAPTER = "compost-adapter-zsh";
const DEFAULT_TRANSFORM_POLICY = "tp-2026-04";

export interface ZshCaptureInput {
  command: string;
  cwd?: string;
  exitStatus?: number | string;
  startedAt?: string;
  endedAt?: string;
  shellPid?: string;
  tty?: string;
  user?: string;
  host?: string;
  sessionId?: string;
  strictRedaction?: boolean;
}

export interface ZshCaptureBuildResult {
  event: OutboxEvent;
  commandId: string;
  redactions: number;
}

interface ZshCaptureOptions {
  command?: string;
  cwd?: string;
  exitStatus?: string;
  startedAt?: string;
  endedAt?: string;
  shellPid?: string;
  tty?: string;
  user?: string;
  host?: string;
  sessionId?: string;
  json?: boolean;
}

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=500");
  applyMigrations(db);
  upsertPolicies(db);
  return db;
}

export function buildZshCaptureEvent(
  input: ZshCaptureInput
): ZshCaptureBuildResult | null {
  const rawCommand = input.command.trim();
  if (!rawCommand || shouldSkipCommand(rawCommand)) return null;

  const cwd = input.cwd?.trim() || process.cwd();
  const endedAt = normalizeTimestamp(input.endedAt) ?? new Date().toISOString();
  const startedAt = normalizeTimestamp(input.startedAt) ?? endedAt;
  const exitStatus = normalizeExitStatus(input.exitStatus);
  const user = input.user?.trim() || process.env["USER"] || "unknown";
  const host =
    input.host?.trim() ||
    process.env["HOST"] ||
    process.env["HOSTNAME"] ||
    "localhost";
  const shellPid = input.shellPid?.trim() || String(process.ppid);
  const sessionId = input.sessionId?.trim() || `${host}:${shellPid}`;

  const redacted = scrub(rawCommand, { strict: input.strictRedaction });
  const commandHash = sha256hex(
    [redacted.scrubbed, cwd, startedAt, endedAt, exitStatus].join("\0")
  ).slice(0, 16);
  const commandId = `zsh:${sessionId}:${startedAt}:${commandHash}`;

  const content = {
    kind: "zsh-command",
    command_id: commandId,
    command: redacted.scrubbed,
    cwd,
    exit_status: exitStatus,
    started_at: startedAt,
    ended_at: endedAt,
    shell_pid: shellPid,
    tty: input.tty?.trim() || null,
    user,
    host,
    redactions: redacted.redactions,
  };

  const contentJson = JSON.stringify(content);
  const sourceId = `zsh:${user}@${host}:${shellPid}`;
  const idempotencyKey = sha256hex(`${ZSH_ADAPTER}:${commandId}:${contentJson}`);
  const sourceUri = `zsh://${host}${cwd.startsWith("/") ? cwd : `/${cwd}`}`;

  return {
    commandId,
    redactions: redacted.redactions,
    event: {
      adapter: ZSH_ADAPTER,
      source_id: sourceId,
      source_kind: "host-adapter",
      source_uri: sourceUri,
      idempotency_key: idempotencyKey,
      trust_tier: "first_party",
      transform_policy: DEFAULT_TRANSFORM_POLICY,
      payload: JSON.stringify({
        content: contentJson,
        mime_type: "application/json",
        occurred_at: endedAt,
        metadata: {
          capture: "zsh",
          command_id: commandId,
          redactions: redacted.redactions,
        },
      }),
    },
  };
}

export function registerCapture(program: Command): void {
  const capture = program
    .command("capture")
    .description("Capture first-party activity into the metacognitive ledger");

  capture
    .command("zsh")
    .description("Capture an interactive zsh command into observe_outbox")
    .option("--command <command>", "Command line to capture")
    .option("--cwd <cwd>", "Command working directory")
    .option("--exit-status <status>", "Command exit status")
    .option("--started-at <iso>", "Command start timestamp")
    .option("--ended-at <iso>", "Command end timestamp")
    .option("--shell-pid <pid>", "Interactive shell process id")
    .option("--tty <tty>", "Interactive terminal")
    .option("--user <user>", "Shell user")
    .option("--host <host>", "Host name")
    .option("--session-id <id>", "Stable shell session id")
    .option("--json", "Print JSON result")
    .action((opts: ZshCaptureOptions) => {
      const built = buildZshCaptureEvent({
        command: opts.command ?? process.env["COMPOST_ZSH_COMMAND"] ?? "",
        cwd: opts.cwd ?? process.env["COMPOST_ZSH_CWD"],
        exitStatus: opts.exitStatus ?? process.env["COMPOST_ZSH_EXIT_STATUS"],
        startedAt: opts.startedAt ?? process.env["COMPOST_ZSH_STARTED_AT"],
        endedAt: opts.endedAt ?? process.env["COMPOST_ZSH_ENDED_AT"],
        shellPid: opts.shellPid ?? process.env["COMPOST_ZSH_SHELL_PID"],
        tty: opts.tty ?? process.env["COMPOST_ZSH_TTY"],
        user: opts.user ?? process.env["USER"],
        host: opts.host ?? process.env["HOST"] ?? process.env["HOSTNAME"],
        sessionId: opts.sessionId ?? process.env["COMPOST_ZSH_SESSION_ID"],
        strictRedaction: process.env["COMPOST_PII_STRICT"] === "true",
      });

      if (!built) {
        if (opts.json) process.stdout.write(JSON.stringify({ skipped: true }) + "\n");
        return;
      }

      const db = openDb();
      try {
        appendToOutbox(db, built.event);
      } finally {
        db.close();
      }

      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            queued: true,
            command_id: built.commandId,
            idempotency_key: built.event.idempotency_key,
            redactions: built.redactions,
          }) + "\n"
        );
      }
    });
}

function shouldSkipCommand(command: string): boolean {
  return (
    command.startsWith("compost capture zsh") ||
    command.includes("packages/compost-cli/src/main.ts capture zsh")
  );
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeExitStatus(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

function sha256hex(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}
