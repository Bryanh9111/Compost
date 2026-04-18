import type { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { v7 as uuidv7 } from "uuid";

/**
 * Phase 6 P0 — User-approved crawl queue.
 *
 * Compost proposes external sources (URLs) to ingest; the user approves or
 * rejects via CLI. This module is **queue management only** — there is no
 * fetch code path. The "never auto-sends requests" first-party principle
 * is enforced by code absence, not by runtime discipline. A later slice
 * adds a user-initiated `compost crawl fetch` verb after product-level
 * design on where fetched content lands (raw observation vs ingest queue
 * vs a dedicated pending-review store, robots.txt policy, size caps).
 *
 * State machine:
 *   proposed -> approved (user says yes)
 *   proposed -> rejected (user says no)
 *   approved / rejected are terminal; `forgetCrawl` hard-deletes the row.
 *   Re-proposing a rejected URL does NOT resurrect — user must `forget`
 *   first. Prevents accidental-reconsideration loops from an automated
 *   proposer (e.g. curiosity agent re-pitching a URL the user already
 *   said no to).
 *
 * Schema: packages/compost-core/src/schema/0017_crawl_queue.sql
 */

export type CrawlStatus = "proposed" | "approved" | "rejected";

export interface CrawlItem {
  crawl_id: string;
  url: string;
  url_hash: string;
  status: CrawlStatus;
  proposed_by: string;
  rationale: string | null;
  tags: string | null;
  proposed_at: string;
  decided_at: string | null;
}

export interface ProposeCrawlOptions {
  rationale?: string;
  tags?: string[];
  proposedBy?: string;
}

export interface ListCrawlOptions {
  status?: CrawlStatus;
  proposedBy?: string;
  limit?: number;
}

/**
 * Normalize a URL for hash-based dedupe:
 *   - lowercase scheme + host (path + query preserved as-is, case matters)
 *   - strip trailing slash on path-less URL
 *   - strip fragment (client-side anchors don't differentiate the resource)
 *   - trim whitespace
 * Throws `TypeError` on unparseable input.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const u = new URL(trimmed); // throws on invalid
  u.hash = "";
  // URL setter lowercases scheme + host automatically.
  let out = u.toString();
  // URL.toString() appends "/" to path-less URLs. Strip it for dedupe
  // equivalence — "https://example.com" and "https://example.com/"
  // are the same resource.
  if (u.pathname === "/") {
    out = out.replace(/\/$/, "");
  }
  return out;
}

export function urlHash(raw: string): string {
  return createHash("sha256").update(normalizeUrl(raw)).digest("hex");
}

export function proposeCrawl(
  db: Database,
  url: string,
  opts: ProposeCrawlOptions = {}
): CrawlItem {
  const normalized = normalizeUrl(url);
  const hash = urlHash(url);

  const existing = db
    .query("SELECT * FROM crawl_queue WHERE url_hash = ?")
    .get(hash) as CrawlItem | undefined;

  const tagsJson = opts.tags ? JSON.stringify(opts.tags) : null;

  if (existing) {
    // Refresh proposed_at + rationale + tags, but NEVER resurrect status.
    // Idempotent on resubmitting same URL with same status.
    db.run(
      `UPDATE crawl_queue
         SET proposed_at = datetime('now'),
             rationale = COALESCE(?, rationale),
             tags = COALESCE(?, tags),
             proposed_by = COALESCE(?, proposed_by)
       WHERE crawl_id = ?`,
      [
        opts.rationale ?? null,
        tagsJson,
        opts.proposedBy ?? null,
        existing.crawl_id,
      ]
    );
    return getCrawlById(db, existing.crawl_id)!;
  }

  const id = uuidv7();
  db.run(
    `INSERT INTO crawl_queue
       (crawl_id, url, url_hash, status, proposed_by, rationale, tags)
     VALUES (?, ?, ?, 'proposed', ?, ?, ?)`,
    [
      id,
      normalized,
      hash,
      opts.proposedBy ?? "user",
      opts.rationale ?? null,
      tagsJson,
    ]
  );
  return getCrawlById(db, id)!;
}

export function listCrawl(
  db: Database,
  opts: ListCrawlOptions = {}
): CrawlItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  } else {
    // Default view: proposed + approved (hide rejected by default; user
    // typically wants to see the actionable queue and the persisted
    // consent record, not the graveyard).
    where.push("status IN ('proposed', 'approved')");
  }
  if (opts.proposedBy) {
    where.push("proposed_by = ?");
    params.push(opts.proposedBy);
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const limitSql = opts.limit ? ` LIMIT ${opts.limit | 0}` : "";
  return db
    .query(
      `SELECT * FROM crawl_queue${whereSql}
       ORDER BY
         CASE status WHEN 'proposed' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
         proposed_at DESC${limitSql}`
    )
    .all(...(params as [])) as CrawlItem[];
}

export function getCrawlById(db: Database, id: string): CrawlItem | null {
  return (
    (db
      .query("SELECT * FROM crawl_queue WHERE crawl_id = ?")
      .get(id) as CrawlItem | undefined) ?? null
  );
}

export function getCrawlByUrl(db: Database, url: string): CrawlItem | null {
  return (
    (db
      .query("SELECT * FROM crawl_queue WHERE url_hash = ?")
      .get(urlHash(url)) as CrawlItem | undefined) ?? null
  );
}

export function approveCrawl(db: Database, id: string): boolean {
  const { changes } = db.run(
    `UPDATE crawl_queue
       SET status = 'approved',
           decided_at = datetime('now')
     WHERE crawl_id = ? AND status = 'proposed'`,
    [id]
  );
  return Number(changes) > 0;
}

export function rejectCrawl(db: Database, id: string): boolean {
  const { changes } = db.run(
    `UPDATE crawl_queue
       SET status = 'rejected',
           decided_at = datetime('now')
     WHERE crawl_id = ? AND status = 'proposed'`,
    [id]
  );
  return Number(changes) > 0;
}

export function forgetCrawl(db: Database, id: string): boolean {
  const { changes } = db.run(
    "DELETE FROM crawl_queue WHERE crawl_id = ?",
    [id]
  );
  return Number(changes) > 0;
}

export interface CrawlStats {
  proposed: number;
  approved: number;
  rejected: number;
  total: number;
}

export function crawlStats(db: Database): CrawlStats {
  const row = db
    .query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END), 0) AS proposed,
         COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
         COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
         COUNT(*) AS total
       FROM crawl_queue`
    )
    .get() as CrawlStats;
  return row;
}
