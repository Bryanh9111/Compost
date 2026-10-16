import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rotateLog } from "../src/persistence/log-rotate";

describe("persistence/log-rotate", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "compost-log-rotate-"));
    path = join(dir, "daemon.log");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("leaves a file below the threshold alone", () => {
    writeFileSync(path, "small\n");
    expect(rotateLog(path, { maxBytes: 100 })).toEqual({ rotated: false, sizeBytes: 6 });
    expect(readFileSync(path, "utf8")).toBe("small\n");
    expect(existsSync(`${path}.1`)).toBe(false);
  });

  test("a missing file is reported, not created", () => {
    expect(rotateLog(path)).toEqual({ rotated: false, sizeBytes: 0 });
    expect(existsSync(path)).toBe(false);
  });

  test("copies, truncates and shifts generations up to keep", () => {
    const opts = { maxBytes: 10, keep: 2 };
    for (const round of [1, 2, 3]) {
      writeFileSync(path, `generation ${round} content\n`);
      const result = rotateLog(path, opts);
      expect(result.rotated).toBe(true);
      expect(result.sizeBytes).toBeGreaterThan(10);
      expect(statSync(path).size).toBe(0);
    }
    expect(readFileSync(`${path}.1`, "utf8")).toBe("generation 3 content\n");
    expect(readFileSync(`${path}.2`, "utf8")).toBe("generation 2 content\n");
    expect(existsSync(`${path}.3`)).toBe(false);
  });

  test("the live file stays writable after rotation", () => {
    writeFileSync(path, "x".repeat(50));
    rotateLog(path, { maxBytes: 10 });
    writeFileSync(path, "after\n", { flag: "a" });
    expect(readFileSync(path, "utf8")).toBe("after\n");
  });
});
