import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Week 4 Day 5 — `compost audit` CLI argument validation.
 *
 * CLI validation paths call process.exit(2) which kills the test runner
 * when invoked in-process, so we spawn the CLI as a subprocess. Covers
 * debate 010 merge-blocker "audit list CLI test" backlog item.
 */

const CLI_MAIN = join(import.meta.dir, "..", "src", "main.ts");

async function runCli(
  args: string[],
  dataDir: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI_MAIN, ...args], {
    env: { ...process.env, COMPOST_DATA_DIR: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("compost audit CLI argument validation", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-audit-cli-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("audit list with no args returns JSON array on empty db (exit 0)", async () => {
    const { code, stdout } = await runCli(["audit", "list"], dataDir);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  test("audit list rejects unknown --kind with exit 2", async () => {
    const { code, stderr } = await runCli(
      ["audit", "list", "--kind", "bogus_kind"],
      dataDir
    );
    expect(code).toBe(2);
    expect(stderr).toContain("unknown --kind");
  });

  test("audit list rejects unknown --decided-by with exit 2", async () => {
    const { code, stderr } = await runCli(
      ["audit", "list", "--decided-by", "nobody"],
      dataDir
    );
    expect(code).toBe(2);
    expect(stderr).toContain("unknown --decided-by");
  });

  test("audit list rejects out-of-range --limit with exit 2", async () => {
    const { code, stderr } = await runCli(
      ["audit", "list", "--limit", "0"],
      dataDir
    );
    expect(code).toBe(2);
    expect(stderr).toContain("--limit must be 1..10000");
  });

  test("audit list accepts valid --kind filter (exit 0)", async () => {
    const { code, stdout } = await runCli(
      ["audit", "list", "--kind", "contradiction_arbitration"],
      dataDir
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });
});

describe("compost triage CLI argument validation", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-triage-cli-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("triage list rejects unknown --kind with exit 2", async () => {
    const { code, stderr } = await runCli(
      ["triage", "list", "--kind", "bogus_signal"],
      dataDir
    );
    expect(code).toBe(2);
    expect(stderr).toContain("unknown --kind");
  });

  test("triage resolve rejects unknown --by with exit 2", async () => {
    const { code, stderr } = await runCli(
      ["triage", "resolve", "1", "--by", "robot"],
      dataDir
    );
    expect(code).toBe(2);
    expect(stderr).toContain("--by must be user or agent");
  });

  test("triage resolve rejects non-integer id with exit 2", async () => {
    const { code, stderr } = await runCli(
      ["triage", "resolve", "abc"],
      dataDir
    );
    expect(code).toBe(2);
    expect(stderr).toContain("<id> must be a positive integer");
  });

  test("triage resolve <missing-id> returns exit 1 with error message (F4)", async () => {
    const { code, stderr } = await runCli(
      ["triage", "resolve", "999999"],
      dataDir
    );
    expect(code).toBe(1);
    expect(stderr).toContain("not found or already resolved");
  });
});
