import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  buildDigest,
  renderDigestMarkdown,
  digestInsightInput,
  type DigestReport,
} from "../src/cognitive/digest";
import { logGap, resolveGap } from "../src/cognitive/gap-tracker";
import { recordDecision } from "../src/cognitive/audit";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function insertSource(db: Database, id: string, kind: string = "local-file"): void {
  db.run(
    "INSERT INTO source VALUES (?,?,?,NULL,0.0,'user',datetime('now'),NULL)",
    [id, `file:///${id}`, kind]
  );
}

function insertObservation(
  db: Database,
  obsId: string,
  sourceId: string,
  daysAgo: number
): void {
  db.run(
    `INSERT INTO observations VALUES
       (?,?,?,
        datetime('now', ? || ' days'),
        datetime('now', ? || ' days'),
        'h','r',NULL,NULL,'text/plain','test',1,'user',?,'tp-2026-04',NULL,NULL,NULL)`,
    [
      obsId,
      sourceId,
      `file:///${sourceId}`,
      -daysAgo,
      -daysAgo,
      `idem-${obsId}`,
    ]
  );
}

interface FactFixture {
  factId: string;
  obsId: string;
  subject?: string;
  predicate?: string;
  object?: string;
  confidence?: number;
  importance?: number;
  daysAgo?: number;
  archived?: boolean;
  supersededBy?: string;
}

function insertFact(db: Database, fx: FactFixture): void {
  db.run(
    `INSERT INTO facts
       (fact_id, subject, predicate, object, confidence, importance,
        observe_id, created_at, archived_at, superseded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ? || ' days'),
             ?, ?)`,
    [
      fx.factId,
      fx.subject ?? "subj",
      fx.predicate ?? "pred",
      fx.object ?? "obj",
      fx.confidence ?? 0.88,
      fx.importance ?? 0.5,
      fx.obsId,
      -(fx.daysAgo ?? 0),
      fx.archived ? "archived" : null,
      fx.supersededBy ?? null,
    ]
  );
}

function insertWikiPage(
  db: Database,
  path: string,
  title: string,
  daysAgo: number
): void {
  db.run(
    `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model)
     VALUES (?, ?, datetime('now', ? || ' days'), 'test-model')`,
    [path, title, -daysAgo]
  );
}

function recordWikiRebuild(
  db: Database,
  pagePath: string,
  inputFactIds: string[]
): void {
  recordDecision(db, {
    kind: "wiki_rebuild",
    targetId: pagePath,
    confidenceTier: "instance",
    confidenceActual: 0.85,
    evidenceRefs: {
      kind: "wiki_rebuild",
      page_path: pagePath,
      input_fact_ids: inputFactIds,
      input_fact_count: inputFactIds.length,
    },
    decidedBy: "wiki",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDigest — empty", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty db yields empty groups", () => {
    const r = buildDigest(db);
    expect(r.items).toEqual([]);
    expect(r.new_facts).toEqual([]);
    expect(r.resolved_gaps).toEqual([]);
    expect(r.wiki_rebuilds).toEqual([]);
    expect(r.window.sinceIso).toBeTruthy();
    expect(r.window.untilIso).toBeTruthy();
    expect(r.generated_at).toBeTruthy();
  });

  test("window defaults to last 7 days; override via sinceDays", () => {
    const r7 = buildDigest(db);
    const r14 = buildDigest(db, { sinceDays: 14 });
    const delta7 =
      Date.parse(r7.window.untilIso) - Date.parse(r7.window.sinceIso);
    const delta14 =
      Date.parse(r14.window.untilIso) - Date.parse(r14.window.sinceIso);
    expect(Math.round(delta7 / 86_400_000)).toBe(7);
    expect(Math.round(delta14 / 86_400_000)).toBe(14);
  });
});

describe("buildDigest — new_facts selector", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("confident fact within window is included", () => {
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.9,
      daysAgo: 1,
    });
    const r = buildDigest(db);
    expect(r.new_facts).toHaveLength(1);
    expect(r.new_facts[0]!.kind).toBe("new_fact");
    expect(r.new_facts[0]!.id).toBe("f1");
    expect(r.new_facts[0]!.refs.fact_id).toBe("f1");
  });

  test("fact below confidence floor is excluded", () => {
    insertFact(db, {
      factId: "f-low",
      obsId: "obs-1",
      confidence: 0.6,
      daysAgo: 1,
    });
    const r = buildDigest(db);
    expect(r.new_facts).toHaveLength(0);
  });

  test("confidence floor is configurable", () => {
    insertFact(db, {
      factId: "f-mid",
      obsId: "obs-1",
      confidence: 0.7,
      daysAgo: 1,
    });
    // default floor = CONFIDENCE_FLOORS.exploration = 0.75 -> 0.7 excluded
    expect(buildDigest(db).new_facts).toHaveLength(0);
    // override below -> included
    expect(buildDigest(db, { confidenceFloor: 0.65 }).new_facts).toHaveLength(1);
  });

  test("default floor is CONFIDENCE_FLOORS.exploration (0.75) — digest semantics, not arbitration", () => {
    // Schema default for facts.confidence is 0.8 (migration 0001); a fact at
    // 0.8 MUST be included by the digest default. Raising the default back to
    // instance/0.85 would silently drop typical personal-KB ingest.
    insertFact(db, {
      factId: "f-typical",
      obsId: "obs-1",
      confidence: 0.8,
      daysAgo: 1,
    });
    expect(buildDigest(db).new_facts).toHaveLength(1);
  });

  test("archived fact is excluded", () => {
    insertFact(db, {
      factId: "f-arch",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
      archived: true,
    });
    expect(buildDigest(db).new_facts).toHaveLength(0);
  });

  test("superseded fact is excluded", () => {
    insertFact(db, {
      factId: "f-new",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    insertFact(db, {
      factId: "f-old",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
      supersededBy: "f-new",
    });
    const r = buildDigest(db);
    expect(r.new_facts.map((f) => f.id)).toEqual(["f-new"]);
  });

  test("fact outside window is excluded", () => {
    insertFact(db, {
      factId: "f-old",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 30,
    });
    expect(buildDigest(db).new_facts).toHaveLength(0);
    expect(buildDigest(db, { sinceDays: 45 }).new_facts).toHaveLength(1);
  });

  test("sorts by importance desc then created_at desc; honors maxItems cap", () => {
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.9,
      importance: 0.3,
      daysAgo: 1,
    });
    insertFact(db, {
      factId: "f2",
      obsId: "obs-1",
      confidence: 0.9,
      importance: 0.9,
      daysAgo: 1,
    });
    insertFact(db, {
      factId: "f3",
      obsId: "obs-1",
      confidence: 0.9,
      importance: 0.5,
      daysAgo: 1,
    });
    const r = buildDigest(db, { maxItems: 2 });
    expect(r.new_facts.map((f) => f.id)).toEqual(["f2", "f3"]);
  });

  test("headline embeds subject/predicate/object + confidence", () => {
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      subject: "Phase 6",
      predicate: "ships",
      object: "gap tracker",
      confidence: 0.92,
      daysAgo: 1,
    });
    const r = buildDigest(db);
    expect(r.new_facts[0]!.headline).toContain("Phase 6");
    expect(r.new_facts[0]!.headline).toContain("ships");
    expect(r.new_facts[0]!.headline).toContain("gap tracker");
    expect(r.new_facts[0]!.headline).toContain("0.92");
  });
});

describe("buildDigest — resolved_gaps selector", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolved gap within window is included", () => {
    const g = logGap(db, "What is quasiperiodicity?");
    resolveGap(db, g.problem_id, { factId: "f-answer" });
    const r = buildDigest(db);
    expect(r.resolved_gaps).toHaveLength(1);
    expect(r.resolved_gaps[0]!.kind).toBe("resolved_gap");
    expect(r.resolved_gaps[0]!.refs.problem_id).toBe(g.problem_id);
    expect(r.resolved_gaps[0]!.refs.fact_id).toBe("f-answer");
  });

  test("open gap is excluded", () => {
    logGap(db, "still open");
    expect(buildDigest(db).resolved_gaps).toHaveLength(0);
  });

  test("headline includes ask_count reinforcement signal", () => {
    const g = logGap(db, "Q?");
    logGap(db, "q"); // bump to 2
    logGap(db, "q?"); // bump to 3
    resolveGap(db, g.problem_id);
    const r = buildDigest(db);
    expect(r.resolved_gaps[0]!.headline).toContain("3");
    expect(r.resolved_gaps[0]!.headline).toContain("Q?");
  });
});

describe("buildDigest — wiki_rebuilds selector", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("wiki page rebuilt within window is included", () => {
    insertWikiPage(db, "/topics/foo", "Foo", 1);
    const r = buildDigest(db);
    expect(r.wiki_rebuilds).toHaveLength(1);
    expect(r.wiki_rebuilds[0]!.kind).toBe("wiki_rebuild");
    expect(r.wiki_rebuilds[0]!.refs.wiki_path).toBe("/topics/foo");
  });

  test("wiki page rebuilt outside window is excluded", () => {
    insertWikiPage(db, "/topics/old", "Old", 30);
    expect(buildDigest(db).wiki_rebuilds).toHaveLength(0);
  });

  test("wiki_rebuild with decision_audit row surfaces contributing_fact_ids (slice 3)", () => {
    insertWikiPage(db, "/topics/foo", "Foo", 1);
    recordWikiRebuild(db, "/topics/foo", ["f-wiki-1", "f-wiki-2"]);

    const r = buildDigest(db);
    expect(r.wiki_rebuilds).toHaveLength(1);
    expect(r.wiki_rebuilds[0]!.refs.contributing_fact_ids).toEqual([
      "f-wiki-1",
      "f-wiki-2",
    ]);
  });

  test("wiki_rebuild without decision_audit row yields no contributing_fact_ids", () => {
    insertWikiPage(db, "/topics/lonely", "Lonely", 1);
    const r = buildDigest(db);
    expect(r.wiki_rebuilds[0]!.refs.contributing_fact_ids).toBeUndefined();
  });

  test("multiple audit rows for same page: latest wins", () => {
    insertWikiPage(db, "/topics/evolving", "Evolving", 1);
    recordWikiRebuild(db, "/topics/evolving", ["f-old-1"]);
    // small delay so decided_at differs; SQLite datetime('now') has second
    // resolution so use two successive recordDecision calls — the second
    // inserts with a LATER id which is our tiebreak.
    recordWikiRebuild(db, "/topics/evolving", ["f-new-1", "f-new-2"]);

    const r = buildDigest(db);
    const ids = r.wiki_rebuilds[0]!.refs.contributing_fact_ids;
    expect(ids).toEqual(["f-new-1", "f-new-2"]);
  });

  test("audit rows for a different wiki_rebuild target do not leak", () => {
    insertWikiPage(db, "/topics/a", "A", 1);
    insertWikiPage(db, "/topics/b", "B", 1);
    recordWikiRebuild(db, "/topics/a", ["f-a"]);
    recordWikiRebuild(db, "/topics/b", ["f-b"]);

    const r = buildDigest(db);
    const byPath = Object.fromEntries(
      r.wiki_rebuilds.map((w) => [
        w.refs.wiki_path,
        w.refs.contributing_fact_ids,
      ])
    );
    expect(byPath["/topics/a"]).toEqual(["f-a"]);
    expect(byPath["/topics/b"]).toEqual(["f-b"]);
  });

  test("items grouped by kind AND in combined items array", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    const g = logGap(db, "Q?");
    resolveGap(db, g.problem_id);
    insertWikiPage(db, "/topics/foo", "Foo", 1);

    const r = buildDigest(db);
    expect(r.items).toHaveLength(3);
    const kinds = new Set(r.items.map((i) => i.kind));
    expect(kinds).toEqual(
      new Set(["new_fact", "resolved_gap", "wiki_rebuild"])
    );
  });
});

describe("renderDigestMarkdown", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty report renders explicit '(no items)' stub", () => {
    const md = renderDigestMarkdown(buildDigest(db));
    expect(md).toContain("# Compost Digest");
    expect(md).toContain("(no items)");
    expect(md).not.toContain("## New confident facts");
  });

  test("non-empty report includes per-group section headers + bullets", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      subject: "Compost",
      predicate: "is",
      object: "a personal KB",
      confidence: 0.9,
      daysAgo: 1,
    });
    const g = logGap(db, "Why digest?");
    resolveGap(db, g.problem_id);
    insertWikiPage(db, "/topics/digest", "Digest", 1);

    const md = renderDigestMarkdown(buildDigest(db));
    expect(md).toContain("## New confident facts");
    expect(md).toContain("## Resolved gaps");
    expect(md).toContain("## Wiki pages rebuilt");
    expect(md).toContain("Compost");
    expect(md).toContain("Why digest?");
    expect(md).toContain("/topics/digest");
  });

  test("omits empty group headers", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.9,
      daysAgo: 1,
    });
    const md = renderDigestMarkdown(buildDigest(db));
    expect(md).toContain("## New confident facts");
    expect(md).not.toContain("## Resolved gaps");
    expect(md).not.toContain("## Wiki pages rebuilt");
  });
});

describe("digestInsightInput", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-digest-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty report yields null", () => {
    expect(digestInsightInput(buildDigest(db))).toBeNull();
  });

  test("wiki-only digest now produces non-null via contributing_fact_ids (slice 3)", () => {
    insertWikiPage(db, "/topics/foo", "Foo", 1);
    recordWikiRebuild(db, "/topics/foo", ["f-wiki-1", "f-wiki-2"]);
    const out = digestInsightInput(buildDigest(db));
    expect(out).not.toBeNull();
    expect(new Set(out!.compostFactIds)).toEqual(
      new Set(["f-wiki-1", "f-wiki-2"])
    );
  });

  test("wiki-only digest without audit provenance stays null", () => {
    insertWikiPage(db, "/topics/orphan", "Orphan", 1);
    expect(digestInsightInput(buildDigest(db))).toBeNull();
  });

  test("merges fact_ids across new_facts + resolved_gaps + wiki contributing", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f-direct",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    const g = logGap(db, "Q?");
    resolveGap(db, g.problem_id, { factId: "f-gap" });
    insertWikiPage(db, "/topics/w", "W", 1);
    recordWikiRebuild(db, "/topics/w", ["f-wiki", "f-direct"]); // f-direct is shared

    const out = digestInsightInput(buildDigest(db));
    expect(new Set(out!.compostFactIds)).toEqual(
      new Set(["f-direct", "f-gap", "f-wiki"])
    );
    // assert sorted output for deterministic UUIDv5 seed
    expect(out!.compostFactIds).toEqual([...out!.compostFactIds].sort());
  });

  test("collects unique fact_ids from new_facts + resolved_gaps", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    insertFact(db, {
      factId: "f2",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    const g = logGap(db, "Q?");
    resolveGap(db, g.problem_id, { factId: "f1" }); // dup — should dedupe

    const out = digestInsightInput(buildDigest(db));
    expect(out).not.toBeNull();
    expect(new Set(out!.compostFactIds)).toEqual(new Set(["f1", "f2"]));
    expect(out!.content).toContain("# Compost Digest");
    expect(out!.synthesizedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("synthesizedAt uses report.generated_at", () => {
    insertSource(db, "s1");
    insertObservation(db, "obs-1", "s1", 1);
    insertFact(db, {
      factId: "f1",
      obsId: "obs-1",
      confidence: 0.95,
      daysAgo: 1,
    });
    const report: DigestReport = buildDigest(db);
    const out = digestInsightInput(report);
    expect(out!.synthesizedAt).toBe(report.generated_at);
  });
});
