import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  dismissGap,
  forgetGap,
  gapStats,
  getByQuestion,
  getById,
  listGaps,
  logGap,
  normalizeQuestion,
  questionHash,
  resolveGap,
} from "../src/cognitive/gap-tracker";

describe("normalizeQuestion", () => {
  test("lowercases, collapses whitespace, strips trailing punctuation", () => {
    expect(normalizeQuestion("What  IS  X??")).toBe("what is x");
    expect(normalizeQuestion("Why, exactly?!")).toBe("why, exactly");
    expect(normalizeQuestion("   trim   me   ")).toBe("trim me");
  });

  test("preserves internal punctuation and tense differences", () => {
    expect(normalizeQuestion("What is X's value?")).toBe("what is x's value");
    expect(normalizeQuestion("What is X?")).not.toBe(normalizeQuestion("What was X?"));
  });

  test("hash same for punctuation and case variants", () => {
    expect(questionHash("What is X?")).toBe(questionHash("what is x"));
    expect(questionHash("What is X?")).toBe(questionHash("What  is  X??"));
  });
});

describe("logGap / getByQuestion", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-gap-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("first ask inserts open row with ask_count=1", () => {
    const gap = logGap(db, "What is quasiperiodicity?", {
      confidence: 0.2,
      observationIds: ["obs-1", "obs-2"],
      tags: ["math"],
    });
    expect(gap.status).toBe("open");
    expect(gap.ask_count).toBe(1);
    expect(gap.last_answer_confidence).toBe(0.2);
    expect(JSON.parse(gap.last_observation_ids!)).toEqual(["obs-1", "obs-2"]);
    expect(JSON.parse(gap.tags!)).toEqual(["math"]);
    expect(gap.resolved_at).toBeNull();
  });

  test("repeated ask bumps ask_count + updates last_asked_at + last_answer_confidence", () => {
    const a = logGap(db, "What is X?", { confidence: 0.1 });
    const b = logGap(db, "what is x?", { confidence: 0.3 });
    expect(b.problem_id).toBe(a.problem_id);
    expect(b.ask_count).toBe(2);
    expect(b.last_answer_confidence).toBe(0.3);
    expect(b.last_asked_at >= a.last_asked_at).toBe(true);
  });

  test("re-ask of dismissed gap bumps ask_count but keeps status=dismissed", () => {
    const a = logGap(db, "Q?");
    dismissGap(db, a.problem_id);
    const b = logGap(db, "q");
    expect(b.status).toBe("dismissed");
    expect(b.ask_count).toBe(2);
  });

  test("getByQuestion finds by normalized hash", () => {
    const a = logGap(db, "What is X?");
    const found = getByQuestion(db, "WHAT IS X");
    expect(found?.problem_id).toBe(a.problem_id);
  });

  test("getByQuestion returns null for unknown question", () => {
    expect(getByQuestion(db, "never asked")).toBeNull();
  });
});

describe("listGaps", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-gap-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("default sort: open first, then by ask_count desc, then last_asked desc", () => {
    const a = logGap(db, "question a");
    const b = logGap(db, "question b");
    logGap(db, "question b"); // bump b to ask_count=2
    resolveGap(db, a.problem_id); // a resolved, ask_count still 1
    const c = logGap(db, "question c");

    const all = listGaps(db);
    expect(all.map((g) => g.question)).toEqual([
      "question b", // open, ask_count=2
      "question c", // open, ask_count=1
      "question a", // resolved, pushed last
    ]);
  });

  test("status filter", () => {
    logGap(db, "q1");
    const q2 = logGap(db, "q2");
    dismissGap(db, q2.problem_id);
    expect(listGaps(db, { status: "open" })).toHaveLength(1);
    expect(listGaps(db, { status: "dismissed" })).toHaveLength(1);
    expect(listGaps(db, { status: "resolved" })).toHaveLength(0);
  });

  test("limit caps result size", () => {
    for (let i = 0; i < 5; i++) logGap(db, `question ${i}`);
    expect(listGaps(db, { limit: 3 })).toHaveLength(3);
  });
});

describe("dismiss / resolve / forget", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-gap-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("dismissGap flips open → dismissed, returns true", () => {
    const gap = logGap(db, "q");
    expect(dismissGap(db, gap.problem_id)).toBe(true);
    expect(getById(db, gap.problem_id)?.status).toBe("dismissed");
  });

  test("dismissGap on already-resolved is a no-op returning false", () => {
    const gap = logGap(db, "q");
    resolveGap(db, gap.problem_id);
    expect(dismissGap(db, gap.problem_id)).toBe(false);
    expect(getById(db, gap.problem_id)?.status).toBe("resolved");
  });

  test("resolveGap records observation_id + fact_id + resolved_at", () => {
    const gap = logGap(db, "q");
    expect(
      resolveGap(db, gap.problem_id, {
        observationId: "obs-42",
        factId: "fact-7",
      })
    ).toBe(true);
    const row = getById(db, gap.problem_id)!;
    expect(row.status).toBe("resolved");
    expect(row.resolved_at).not.toBeNull();
    expect(row.resolved_by_observation_id).toBe("obs-42");
    expect(row.resolved_by_fact_id).toBe("fact-7");
  });

  test("forgetGap removes the row entirely", () => {
    const gap = logGap(db, "q");
    expect(forgetGap(db, gap.problem_id)).toBe(true);
    expect(getById(db, gap.problem_id)).toBeNull();
    expect(forgetGap(db, gap.problem_id)).toBe(false);
  });
});

describe("gapStats", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-gap-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("zero rows yields all zeros", () => {
    expect(gapStats(db)).toEqual({
      open: 0,
      resolved: 0,
      dismissed: 0,
      total_asks: 0,
    });
  });

  test("counts by status + sums ask_count", () => {
    const a = logGap(db, "q1");
    logGap(db, "q1"); // bump to 2
    logGap(db, "q1"); // bump to 3
    const b = logGap(db, "q2");
    const c = logGap(db, "q3");
    dismissGap(db, b.problem_id);
    resolveGap(db, c.problem_id);
    const stats = gapStats(db);
    expect(stats).toEqual({
      open: 1,
      resolved: 1,
      dismissed: 1,
      total_asks: 3 + 1 + 1,
    });
    // Assert `a` stays open with 3 asks
    const row = getById(db, a.problem_id)!;
    expect(row.ask_count).toBe(3);
  });
});
