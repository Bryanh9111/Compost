import { spyOn } from "bun:test";
import { createProgram } from "../src/main";

/** Exercise the actual command handlers, including exits, within coverage.
 * Tests run serially and always restore process globals. Process/PID lifecycle
 * tests keep their separate subprocess harness. */
export async function runCli(args: string[], dataDir: string) {
  const previousDir = process.env["COMPOST_DATA_DIR"];
  const previousCode = process.exitCode;
  let stdout = "";
  let stderr = "";
  let code = 0;
  class CliExit extends Error {}
  process.env["COMPOST_DATA_DIR"] = dataDir;
  process.exitCode = 0;
  const out = spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
  const err = spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
  const log = spyOn(console, "log").mockImplementation((...items: unknown[]) => { stdout += items.map(String).join(" ") + "\n"; });
  const error = spyOn(console, "error").mockImplementation((...items: unknown[]) => { stderr += items.map(String).join(" ") + "\n"; });
  const exit = spyOn(process, "exit").mockImplementation((value) => { code = Number(value ?? 0); throw new CliExit(); });
  try {
    await createProgram().parseAsync(["bun", "compost", ...args]);
    code = Number(process.exitCode ?? 0);
  } catch (e) {
    if (!(e instanceof CliExit)) throw e;
  } finally {
    exit.mockRestore(); out.mockRestore(); err.mockRestore(); log.mockRestore(); error.mockRestore();
    if (previousDir === undefined) delete process.env["COMPOST_DATA_DIR"];
    else process.env["COMPOST_DATA_DIR"] = previousDir;
    process.exitCode = previousCode;
  }
  return { code, exitCode: code, stdout, stderr };
}
