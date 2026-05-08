import { Command } from "@commander-js/extra-typings";
import { join } from "path";
import { createConnection } from "net";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function dataDir(): string {
  return process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
}

function sockPath(): string {
  return join(dataDir(), "daemon.sock");
}

interface SchedulerHealth {
  name: string;
  last_tick_at: string | null;
  error_count: number;
  running: boolean;
}

interface DaemonStatus {
  pid: number;
  uptime: number;
  schedulers?: SchedulerHealth[];
}

function isDaemonStatus(value: unknown): value is DaemonStatus {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["pid"] === "number" && typeof record["uptime"] === "number";
}

export function formatDaemonStatus(value: unknown): string {
  if (!isDaemonStatus(value)) {
    return JSON.stringify(value, null, 2);
  }

  const uptimeSeconds = Math.round(value.uptime);
  const lines = [`pid: ${value.pid}  uptime: ${uptimeSeconds}s`];
  if (Array.isArray(value.schedulers)) {
    const nameWidth = Math.max(9, ...value.schedulers.map((s) => s.name.length));
    lines.push("schedulers:");
    for (const scheduler of value.schedulers) {
      const state = scheduler.running ? "[running]" : "[stopped]";
      const lastTick = scheduler.last_tick_at ?? "never";
      lines.push(
        `  ${scheduler.name.padEnd(nameWidth)} ${state} last_tick=${lastTick.padEnd(19)} errors=${scheduler.error_count}`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Send a command over the Unix control socket, return parsed response.
 */
async function sendSocket(cmd: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(sockPath());
    let buf = "";

    sock.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        sock.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch {
          resolve(buf.slice(0, nl));
        }
      }
    });

    sock.on("error", reject);
    sock.on("connect", () => {
      sock.write(cmd + "\n");
    });
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerDaemon(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the Compost daemon process");

  daemon
    .command("start")
    .description("Start the daemon")
    .option(
      "--with-mcp",
      "also start the embedded stdio MCP server (foreground-only; prefer `compost mcp` for MCP clients)"
    )
    .action(async (opts) => {
      // Lazy import so CLI startup stays fast when daemon not needed
      const { startDaemon } = await import(
        "../../../compost-daemon/src/main"
      );
      const dir = dataDir();
      process.stdout.write(`starting daemon in ${dir}\n`);
      try {
        await startDaemon(dir, opts.withMcp === true, { disabled: false });
      } catch (err) {
        process.stderr.write(`error: ${errorMessage(err)}\n`);
        process.exitCode = 1;
      }
      // startDaemon keeps process alive via signal handlers
    });

  daemon
    .command("stop")
    .description("Stop the running daemon")
    .action(async () => {
      await sendSocket("stop");
      process.stdout.write("stop sent\n");
    });

  daemon
    .command("status")
    .description("Print daemon status")
    .action(async () => {
      const result = await sendSocket("status");
      process.stdout.write(formatDaemonStatus(result) + "\n");
    });

  daemon
    .command("reload")
    .description("Reload policies without restart")
    .action(async () => {
      const result = await sendSocket("reload");
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    });
}
