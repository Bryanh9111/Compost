import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Drives the real polling watcher (scripts/compost-obsidian-watch.sh) against a
 * stub `compost capture obsidian` CLI. macOS-only: the script relies on
 * `/usr/bin/stat -f` and `/sbin/md5`. */

const SCRIPT_PATH = resolve(import.meta.dir, "../../../scripts/compost-obsidian-watch.sh");
const TEST_TIMEOUT_MS = 60_000;

const STUB_CLI = `import { appendFileSync, existsSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.STUB_FAIL_MARKER && existsSync(process.env.STUB_FAIL_MARKER)) process.exit(1);
process.exit(0);
`;

interface Fixture {
  root: string;
  repo: string;
  vault: string;
  dataDir: string;
  stateDir: string;
  stubLog: string;
  failMarker: string;
  alpha: string;
  beta: string;
  ignored: string;
}

const fixtures: Fixture[] = [];

function createFixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "compost-obsidian-watch-")));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "packages/compost-cli/src"), { recursive: true });
  writeFileSync(join(repo, "packages/compost-cli/src/main.ts"), STUB_CLI);

  const vault = join(root, "vault");
  mkdirSync(join(vault, "sub"), { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const alpha = join(vault, "alpha.md");
  const beta = join(vault, "sub", "beta.md");
  const ignored = join(vault, ".obsidian", "ignored.md");
  writeFileSync(alpha, "# alpha\n");
  writeFileSync(beta, "# beta\n");
  writeFileSync(ignored, "# ignored\n");

  const dataDir = join(root, "data");
  const fixture: Fixture = {
    root,
    repo,
    vault,
    dataDir,
    stateDir: join(dataDir, "obsidian-watch-state"),
    stubLog: join(root, "stub.log"),
    failMarker: join(root, "fail.marker"),
    alpha,
    beta,
    ignored,
  };
  fixtures.push(fixture);
  return fixture;
}

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture.root, { recursive: true, force: true });
});

async function runWatcher(fixture: Fixture, polls = 1) {
  const proc = Bun.spawn(["/bin/zsh", SCRIPT_PATH, fixture.vault], {
    env: {
      ...process.env,
      COMPOST_REPO: fixture.repo,
      COMPOST_DATA_DIR: fixture.dataDir,
      COMPOST_OBSIDIAN_POLL_SEC: "1",
      COMPOST_OBSIDIAN_FORCE_POLL: "1",
      COMPOST_OBSIDIAN_MAX_POLLS: String(polls),
      STUB_LOG: fixture.stubLog,
      STUB_FAIL_MARKER: fixture.failMarker,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  expect(exitCode, `watcher stderr: ${stderr}`).toBe(0);
  return { exitCode, stderr };
}

function readCaptures(fixture: Fixture): string[][] {
  if (!existsSync(fixture.stubLog)) return [];
  return readFileSync(fixture.stubLog, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/** Mirrors state_key() in the script: sanitized relative-path prefix + md5. */
function stateFileFor(fixture: Fixture, notePath: string): string {
  const relative = notePath.slice(fixture.vault.length + 1);
  const prefix = relative.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const digest = new Bun.CryptoHasher("md5").update(relative).digest("hex");
  return join(fixture.stateDir, `${prefix}-${digest}`);
}

function readState(fixture: Fixture, notePath: string): string | null {
  const file = stateFileFor(fixture, notePath);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

function listStateFiles(fixture: Fixture): string[] {
  return readdirSync(fixture.stateDir).filter((name) => !name.startsWith("."));
}

/** Rewrites the note and pushes its mtime to a later whole second so the
 * `%m:%z` signature changes even inside the same wall-clock second. */
function modifyNote(notePath: string, content: string): void {
  const previous = statSync(notePath).mtime;
  writeFileSync(notePath, content);
  const bumped = new Date(Math.floor(previous.getTime() / 1000) * 1000 + 2000);
  utimesSync(notePath, bumped, bumped);
}

function expectedModifiedAt(notePath: string): string {
  return statSync(notePath).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
}

describe.skipIf(process.platform !== "darwin")("compost-obsidian-watch polling", () => {
  test(
    "first run baselines every vault note without capturing",
    async () => {
      const fixture = createFixture();

      await runWatcher(fixture);

      expect(readCaptures(fixture)).toEqual([]);
      expect(readState(fixture, fixture.alpha)).toMatch(/^\d+:\d+$/);
      expect(readState(fixture, fixture.beta)).toMatch(/^\d+:\d+$/);
      expect(readState(fixture, fixture.ignored)).toBeNull();
      expect(listStateFiles(fixture)).toHaveLength(2);
      expect(existsSync(join(fixture.stateDir, ".initialized"))).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  test(
    "captures a modified note with a UTC modified-at timestamp",
    async () => {
      const fixture = createFixture();
      await runWatcher(fixture);

      modifyNote(fixture.alpha, "# alpha\n\nedited\n");
      await runWatcher(fixture);

      const captures = readCaptures(fixture);
      expect(captures).toHaveLength(1);
      const argv = captures[0]!;
      expect(argv.slice(0, 2)).toEqual(["capture", "obsidian"]);
      expect(argValue(argv, "--vault-root")).toBe(fixture.vault);
      expect(argValue(argv, "--path")).toBe(fixture.alpha);
      expect(argValue(argv, "--event")).toBe("poll");
      expect(argValue(argv, "--modified-at")).toBe(expectedModifiedAt(fixture.alpha));
      expect(argValue(argv, "--size-bytes")).toBe(String(statSync(fixture.alpha).size));
      expect(readState(fixture, fixture.beta)).toMatch(/^\d+:\d+$/);
    },
    TEST_TIMEOUT_MS
  );

  test(
    "keeps the old signature when capture fails and retries on the next run",
    async () => {
      const fixture = createFixture();
      await runWatcher(fixture);
      const oldSignature = readState(fixture, fixture.beta);

      modifyNote(fixture.beta, "# beta\n\nedited\n");
      writeFileSync(fixture.failMarker, "");
      await runWatcher(fixture);

      const failedAttempts = readCaptures(fixture);
      expect(failedAttempts).toHaveLength(1);
      expect(argValue(failedAttempts[0]!, "--path")).toBe(fixture.beta);
      expect(readState(fixture, fixture.beta)).toBe(oldSignature);

      unlinkSync(fixture.failMarker);
      await runWatcher(fixture);

      const captures = readCaptures(fixture);
      expect(captures).toHaveLength(2);
      expect(argValue(captures[1]!, "--path")).toBe(fixture.beta);
      const newSignature = readState(fixture, fixture.beta);
      expect(newSignature).not.toBe(oldSignature);
      expect(newSignature).toBe(
        `${Math.floor(statSync(fixture.beta).mtimeMs / 1000)}:${statSync(fixture.beta).size}`
      );
    },
    TEST_TIMEOUT_MS
  );

  test(
    "catches up notes changed while the watcher was down but only baselines new notes",
    async () => {
      const fixture = createFixture();
      await runWatcher(fixture);

      modifyNote(fixture.alpha, "# alpha\n\nchanged while down\n");
      const gamma = join(fixture.vault, "gamma.md");
      writeFileSync(gamma, "# gamma\n");
      await runWatcher(fixture);

      const captures = readCaptures(fixture);
      expect(captures.map((argv) => argValue(argv, "--path"))).toEqual([fixture.alpha]);
      expect(readState(fixture, gamma)).toMatch(/^\d+:\d+$/);
      expect(listStateFiles(fixture)).toHaveLength(3);
    },
    TEST_TIMEOUT_MS
  );
});
