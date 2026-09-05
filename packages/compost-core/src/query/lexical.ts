import type { Database } from "bun:sqlite";

/** User input is always literal; MATCH operators are constructed here only. */
export function prepareFts5Query(text: string): string {
  const words = [
    ...new Set(
      Array.from(text.matchAll(/[\p{L}\p{N}_]+/gu), (m) => m[0]).filter(
        (w) => w.length > 1,
      ),
    ),
  ];
  return words.map((w) => `"${w}"`).join(" OR ");
}

/** Phrase positions on overlapping UTF-8 Han bigrams preserve exact adjacency. */
export function prepareCjkQuery(text: string): string {
  const runs = [
    ...new Set(
      Array.from(
        text.matchAll(/[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]{2,}/gu),
        (m) => m[0],
      ),
    ),
  ];
  return runs
    .map((run) => {
      const chars = Array.from(run);
      const terms = chars
        .slice(0, -1)
        .map((ch, i) => Buffer.from(ch + chars[i + 1], "utf8").toString("hex"));
      return `"${terms.join(" ")}"`;
    })
    .join(" OR ");
}

/** Filters are internal SQL against alias s; values remain bound parameters. */
export function lexicalCandidates(
  db: Database,
  kind: "actions" | "facts",
  text: string,
  opts: {
    where?: string;
    params?: Array<string | number>;
    limit?: number;
  } = {},
): Array<{ rowid: number; relevance: number }> {
  const table = kind === "actions" ? "action_log" : "facts";
  const id = kind === "actions" ? "action_id" : "fact_id";
  const branches: string[] = [];
  const params: Array<string | number> = [];
  const keyword = prepareFts5Query(text),
    cjk = prepareCjkQuery(text);
  if (keyword) {
    branches.push(
      `SELECT rowid,rank AS relevance FROM ${kind}_fts WHERE ${kind}_fts MATCH ?`,
    );
    params.push(keyword);
  }
  if (cjk) {
    branches.push(
      `SELECT rowid,rank AS relevance FROM ${table}_cjk WHERE ${table}_cjk MATCH ?`,
    );
    params.push(cjk);
  }
  branches.push(`SELECT rowid,-1e9 AS relevance FROM ${table} WHERE ${id}=?`);
  params.push(text.trim());
  return db
    .query(`WITH candidates AS (${branches.join(" UNION ALL ")}),
 matched AS (SELECT rowid,min(relevance) AS relevance FROM candidates GROUP BY rowid)
 SELECT s.rowid,matched.relevance FROM ${table} s JOIN matched ON matched.rowid=s.rowid
 WHERE ${opts.where ?? "1"} ORDER BY matched.relevance,s.rowid LIMIT ?`)
    .all(...params, ...(opts.params ?? []), opts.limit ?? 200) as Array<{
    rowid: number;
    relevance: number;
  }>;
}
