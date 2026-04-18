import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  proposeCrawl,
  listCrawl,
  approveCrawl,
  rejectCrawl,
  forgetCrawl,
  crawlStats,
  type CrawlStatus,
} from "../../../compost-core/src/cognitive/crawl-queue";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

export function registerCrawl(program: Command): void {
  const crawl = program
    .command("crawl")
    .description(
      "User-approved crawl queue (Phase 6 P0). Compost queues external sources; user approves/rejects. No fetch code path in this slice — explicit first-party compliance"
    );

  crawl
    .command("propose <url>")
    .description("Propose a URL for ingest (status=proposed)")
    .option("--rationale <text>", "Why this URL is worth ingesting")
    .option(
      "--proposed-by <source>",
      "Who proposed this: user | curiosity | digest",
      "user"
    )
    .option(
      "--tag <tag>",
      "Tag (repeatable)",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[]
    )
    .option("--json", "Emit full row as JSON", false)
    .action((url, opts) => {
      const db = openDb();
      try {
        const proposeOpts: {
          rationale?: string;
          tags?: string[];
          proposedBy?: string;
        } = { proposedBy: opts.proposedBy };
        if (opts.rationale !== undefined) proposeOpts.rationale = opts.rationale;
        if (opts.tag.length > 0) proposeOpts.tags = opts.tag;
        const item = proposeCrawl(db, url, proposeOpts);
        process.stdout.write(JSON.stringify(item, null, 2) + "\n");
      } finally {
        db.close();
      }
    });

  crawl
    .command("list")
    .description("List crawl queue items (default: proposed + approved)")
    .option(
      "--status <status>",
      "Filter by status: proposed | approved | rejected"
    )
    .option("--proposed-by <source>", "Filter by proposer")
    .option("--limit <n>", "Max rows", (v) => Number.parseInt(v, 10), 50)
    .option("--json", "Emit full rows as JSON", false)
    .action((opts) => {
      const db = openDb();
      try {
        const listOpts: {
          status?: CrawlStatus;
          proposedBy?: string;
          limit: number;
        } = { limit: opts.limit };
        if (
          opts.status === "proposed" ||
          opts.status === "approved" ||
          opts.status === "rejected"
        ) {
          listOpts.status = opts.status;
        }
        if (opts.proposedBy !== undefined) listOpts.proposedBy = opts.proposedBy;

        const rows = listCrawl(db, listOpts);
        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
          return;
        }
        if (rows.length === 0) {
          process.stdout.write("(no crawl items)\n");
          return;
        }
        for (const r of rows) {
          const rationale = r.rationale ? `\n  rationale: ${r.rationale}` : "";
          process.stdout.write(
            `[${r.status}] ${r.crawl_id} by=${r.proposed_by}\n  ${r.url}${rationale}\n  proposed=${r.proposed_at}${r.decided_at ? ` decided=${r.decided_at}` : ""}\n`
          );
        }
      } finally {
        db.close();
      }
    });

  crawl
    .command("approve <id>")
    .description("Approve a proposed URL (consent record; no fetch yet)")
    .action((id) => {
      const db = openDb();
      try {
        const ok = approveCrawl(db, id);
        process.stdout.write(
          JSON.stringify({ approve: ok, id }, null, 2) + "\n"
        );
        if (!ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  crawl
    .command("reject <id>")
    .description("Reject a proposed URL (persistent veto record)")
    .action((id) => {
      const db = openDb();
      try {
        const ok = rejectCrawl(db, id);
        process.stdout.write(
          JSON.stringify({ reject: ok, id }, null, 2) + "\n"
        );
        if (!ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  crawl
    .command("forget <id>")
    .description("Hard-delete a crawl row regardless of status")
    .action((id) => {
      const db = openDb();
      try {
        const ok = forgetCrawl(db, id);
        process.stdout.write(
          JSON.stringify({ forget: ok, id }, null, 2) + "\n"
        );
        if (!ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  crawl
    .command("stats")
    .description("Summary counts across crawl queue statuses")
    .action(() => {
      const db = openDb();
      try {
        process.stdout.write(JSON.stringify(crawlStats(db), null, 2) + "\n");
      } finally {
        db.close();
      }
    });
}
