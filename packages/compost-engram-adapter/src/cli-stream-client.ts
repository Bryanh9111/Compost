import {
  type EngramStreamClient,
  type EngramStreamEntry,
  type StreamForCompostArgs,
  engramStreamEntrySchema,
} from "./stream-puller";
import type { MCPCallResult } from "./writer";

// Minimal spawn-like interface so tests can inject a fake without pulling
// in a process mocking framework. Matches Bun.spawn's surface for what
// CliEngramStreamClient actually uses.
export interface SpawnFn {
  (args: {
    cmd: string[];
    stdout: "pipe";
    stderr: "pipe";
    env?: Record<string, string>;
  }): {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
  };
}

const defaultSpawn: SpawnFn = (opts) =>
  Bun.spawn(opts.cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env as Record<string, string> | undefined,
  });

export interface CliEngramStreamClientOptions {
  /**
   * Path or command name for the Engram CLI binary. Default: "engram"
   * (looked up via PATH). Tests pass a fake; production may override
   * for venv / pipx installs.
   */
  engramBin?: string;
  /**
   * Additional env vars passed to the subprocess. Useful for overriding
   * ENGRAM_DB_PATH in tests.
   */
  env?: Record<string, string>;
  /**
   * Injectable spawn for unit tests.
   */
  spawn?: SpawnFn;
}

/**
 * Concrete EngramStreamClient implementation that invokes the Engram CLI
 * `export-stream` subcommand. JSONL output is parsed line-by-line and
 * validated through the shared zod contract (debate 021 drift guard).
 *
 * Failure modes (MCPCallResult.error rather than throw):
 * - subprocess exit != 0 → stderr attached
 * - malformed JSONL line → first offending line number reported
 * - zod rejection → captured with the specific entry's memory_id if known
 */
export class CliEngramStreamClient implements EngramStreamClient {
  private readonly engramBin: string;
  private readonly env?: Record<string, string>;
  private readonly spawn: SpawnFn;

  constructor(opts: CliEngramStreamClientOptions = {}) {
    this.engramBin = opts.engramBin ?? "engram";
    if (opts.env !== undefined) this.env = opts.env;
    this.spawn = opts.spawn ?? defaultSpawn;
  }

  async streamForCompost(
    args: StreamForCompostArgs
  ): Promise<MCPCallResult<EngramStreamEntry[]>> {
    const cmd = this.buildCmd(args);

    let exitCode: number;
    let stdout: string;
    let stderr: string;
    try {
      const spawnArgs: {
        cmd: string[];
        stdout: "pipe";
        stderr: "pipe";
        env?: Record<string, string>;
      } = {
        cmd,
        stdout: "pipe",
        stderr: "pipe",
      };
      if (this.env !== undefined) spawnArgs.env = this.env;
      const proc = this.spawn(spawnArgs);
      exitCode = await proc.exited;
      stdout = await new Response(proc.stdout).text();
      stderr = await new Response(proc.stderr).text();
    } catch (e) {
      return {
        ok: false,
        error: `engram subprocess failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }

    if (exitCode !== 0) {
      return {
        ok: false,
        error: `engram exited ${exitCode}: ${stderr.slice(0, 500)}`,
      };
    }

    return parseJsonlEntries(stdout);
  }

  private buildCmd(args: StreamForCompostArgs): string[] {
    const cmd = [this.engramBin, "export-stream"];
    if (args.since) cmd.push("--since", args.since);
    if (args.kinds) for (const k of args.kinds) cmd.push("--kinds", k);
    if (args.project) cmd.push("--project", args.project);
    if (args.include_compost) cmd.push("--include-compost");
    if (args.limit !== undefined) cmd.push("--limit", String(args.limit));
    return cmd;
  }
}

export function parseJsonlEntries(
  stdout: string
): MCPCallResult<EngramStreamEntry[]> {
  const entries: EngramStreamEntry[] = [];
  const lines = stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      return {
        ok: false,
        error: `invalid JSON on line ${i + 1}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    try {
      entries.push(engramStreamEntrySchema.parse(parsed));
    } catch (e) {
      const memoryId =
        typeof parsed === "object" &&
        parsed !== null &&
        "memory_id" in parsed &&
        typeof (parsed as { memory_id: unknown }).memory_id === "string"
          ? (parsed as { memory_id: string }).memory_id
          : "(unknown)";
      return {
        ok: false,
        error: `schema rejection on line ${i + 1} (memory_id=${memoryId}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }
  return { ok: true, data: entries };
}
