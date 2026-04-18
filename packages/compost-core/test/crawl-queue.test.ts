import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  proposeCrawl,
  listCrawl,
  getCrawlById,
  getCrawlByUrl,
  approveCrawl,
  rejectCrawl,
  forgetCrawl,
  crawlStats,
  normalizeUrl,
  urlHash,
} from "../src/cognitive/crawl-queue";

describe("normalizeUrl", () => {
  test("lowercases scheme + host, strips trailing slash, keeps path+query case", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path?Q=V")).toBe(
      "https://example.com/Path?Q=V"
    );
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  test("trims whitespace", () => {
    expect(normalizeUrl("   https://example.com/x   ")).toBe(
      "https://example.com/x"
    );
  });

  test("throws on unparseable URL", () => {
    expect(() => normalizeUrl("not a url")).toThrow();
  });

  test("strips fragment", () => {
    expect(normalizeUrl("https://example.com/x#frag")).toBe(
      "https://example.com/x"
    );
  });
});

describe("urlHash", () => {
  test("case variants of the same URL hash to the same value", () => {
    expect(urlHash("HTTPS://Example.com/x")).toBe(urlHash("https://example.com/x"));
  });

  test("different URLs hash differently", () => {
    expect(urlHash("https://a.com")).not.toBe(urlHash("https://b.com"));
  });
});

describe("proposeCrawl", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-crawl-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("first propose inserts status=proposed with defaults", () => {
    const item = proposeCrawl(db, "https://example.com/docs");
    expect(item.status).toBe("proposed");
    expect(item.url).toBe("https://example.com/docs");
    expect(item.proposed_by).toBe("user");
    expect(item.rationale).toBeNull();
    expect(item.decided_at).toBeNull();
  });

  test("rationale + tags + proposed_by recorded", () => {
    const item = proposeCrawl(db, "https://example.com/x", {
      rationale: "cluster 3 keeps asking about quasiperiodicity",
      tags: ["math", "curiosity-auto"],
      proposedBy: "curiosity",
    });
    expect(item.rationale).toBe(
      "cluster 3 keeps asking about quasiperiodicity"
    );
    expect(JSON.parse(item.tags!)).toEqual(["math", "curiosity-auto"]);
    expect(item.proposed_by).toBe("curiosity");
  });

  test("re-propose same URL returns existing row, updates proposed_at + rationale", () => {
    const a = proposeCrawl(db, "https://example.com/x", {
      rationale: "first",
    });
    const b = proposeCrawl(db, "HTTPS://Example.com/x", {
      rationale: "second",
    });
    expect(b.crawl_id).toBe(a.crawl_id);
    expect(b.rationale).toBe("second");
  });

  test("re-propose does NOT resurrect rejected row", () => {
    const a = proposeCrawl(db, "https://example.com/x");
    rejectCrawl(db, a.crawl_id);
    const b = proposeCrawl(db, "https://example.com/x", {
      rationale: "changed my mind",
    });
    expect(b.crawl_id).toBe(a.crawl_id);
    expect(b.status).toBe("rejected"); // user must re-propose by first forgetting
  });
});

describe("listCrawl", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-crawl-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("default view: proposed first (actionable), then approved, hides rejected", () => {
    proposeCrawl(db, "https://a.com");
    const b = proposeCrawl(db, "https://b.com");
    const c = proposeCrawl(db, "https://c.com");
    approveCrawl(db, b.crawl_id);
    rejectCrawl(db, c.crawl_id);

    const rows = listCrawl(db);
    // proposed (a) bubbles ahead of approved (b); rejected (c) excluded
    expect(rows.map((r) => r.url)).toEqual(["https://a.com", "https://b.com"]);
  });

  test("status filter", () => {
    const a = proposeCrawl(db, "https://a.com");
    const b = proposeCrawl(db, "https://b.com");
    approveCrawl(db, b.crawl_id);
    rejectCrawl(db, a.crawl_id);

    expect(listCrawl(db, { status: "approved" }).map((r) => r.url)).toEqual([
      "https://b.com",
    ]);
    expect(listCrawl(db, { status: "rejected" }).map((r) => r.url)).toEqual([
      "https://a.com",
    ]);
  });

  test("limit caps result size", () => {
    for (let i = 0; i < 5; i++) proposeCrawl(db, `https://${i}.com`);
    expect(listCrawl(db, { limit: 3 })).toHaveLength(3);
  });

  test("proposedBy filter", () => {
    proposeCrawl(db, "https://a.com", { proposedBy: "user" });
    proposeCrawl(db, "https://b.com", { proposedBy: "curiosity" });
    const rows = listCrawl(db, { proposedBy: "curiosity" });
    expect(rows.map((r) => r.url)).toEqual(["https://b.com"]);
  });
});

describe("approve / reject / forget state machine", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-crawl-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("approveCrawl flips proposed → approved, stamps decided_at", () => {
    const a = proposeCrawl(db, "https://a.com");
    expect(approveCrawl(db, a.crawl_id)).toBe(true);
    const row = getCrawlById(db, a.crawl_id)!;
    expect(row.status).toBe("approved");
    expect(row.decided_at).not.toBeNull();
  });

  test("approveCrawl on already-approved is no-op returning false", () => {
    const a = proposeCrawl(db, "https://a.com");
    approveCrawl(db, a.crawl_id);
    expect(approveCrawl(db, a.crawl_id)).toBe(false);
  });

  test("approveCrawl cannot flip a rejected row", () => {
    const a = proposeCrawl(db, "https://a.com");
    rejectCrawl(db, a.crawl_id);
    expect(approveCrawl(db, a.crawl_id)).toBe(false);
    expect(getCrawlById(db, a.crawl_id)?.status).toBe("rejected");
  });

  test("rejectCrawl flips proposed → rejected, stamps decided_at", () => {
    const a = proposeCrawl(db, "https://a.com");
    expect(rejectCrawl(db, a.crawl_id)).toBe(true);
    const row = getCrawlById(db, a.crawl_id)!;
    expect(row.status).toBe("rejected");
    expect(row.decided_at).not.toBeNull();
  });

  test("rejectCrawl cannot flip an approved row", () => {
    const a = proposeCrawl(db, "https://a.com");
    approveCrawl(db, a.crawl_id);
    expect(rejectCrawl(db, a.crawl_id)).toBe(false);
  });

  test("forgetCrawl hard-deletes regardless of status", () => {
    const a = proposeCrawl(db, "https://a.com");
    approveCrawl(db, a.crawl_id);
    expect(forgetCrawl(db, a.crawl_id)).toBe(true);
    expect(getCrawlById(db, a.crawl_id)).toBeNull();
    // Idempotent — second forget returns false
    expect(forgetCrawl(db, a.crawl_id)).toBe(false);
  });

  test("getCrawlByUrl finds a row by normalized hash", () => {
    const a = proposeCrawl(db, "https://example.com/x");
    const found = getCrawlByUrl(db, "HTTPS://Example.COM/x");
    expect(found?.crawl_id).toBe(a.crawl_id);
  });
});

describe("crawlStats", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-crawl-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty queue → all zeros", () => {
    expect(crawlStats(db)).toEqual({
      proposed: 0,
      approved: 0,
      rejected: 0,
      total: 0,
    });
  });

  test("counts by status", () => {
    const a = proposeCrawl(db, "https://a.com");
    proposeCrawl(db, "https://b.com");
    const c = proposeCrawl(db, "https://c.com");
    approveCrawl(db, a.crawl_id);
    rejectCrawl(db, c.crawl_id);
    expect(crawlStats(db)).toEqual({
      proposed: 1,
      approved: 1,
      rejected: 1,
      total: 3,
    });
  });
});
