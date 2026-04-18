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

export function registerDaemon(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the Compost daemon process");

  daemon
    .command("start")
    .description("Start the daemon")
    .action(async () => {
      // Lazy import so CLI startup stays fast when daemon not needed
      const { startDaemon } = await import(
        "../../../compost-daemon/src/main"
      );
      const dir = dataDir();
      process.stdout.write(`starting daemon in ${dir}\n`);
      await startDaemon(dir, true, { disabled: false });
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
    .description("Print daemon status JSON")
    .action(async () => {
      const result = await sendSocket("status");
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    });

  daemon
    .command("reload")
    .description("Reload policies without restart")
    .action(async () => {
      const result = await sendSocket("reload");
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    });
}
