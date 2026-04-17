#!/usr/bin/env bun
/**
 * Phase 5 gate: probe whether Engram is ready for `compost-engram-adapter`
 * implementation to begin.
 *
 * Per v7 handover + debate 019, the Engram Phase 2 first commit must
 * expose the three MCP tools Compost will consume, plus the API-surface
 * invariant test and the schema/drift-whitelist doc:
 *
 *   mcp__engram__write_compost_insight
 *   mcp__engram__stream_for_compost
 *   mcp__engram__invalidate_compost_fact
 *   tests/test_api_surface_coverage.py  (Engram repo)
 *   docs/non-exposed-schema-fields.md   (Engram repo)
 *
 * The schema side must also include `origin=compost` as a CHECK-enforced
 * literal (debate 019) and the `compost_cache` table DDL (debate 016).
 *
 * Usage:
 *   bun scripts/probe-engram-readiness.ts
 *   bun scripts/probe-engram-readiness.ts --engram-repo ../Engram
 *   bun scripts/probe-engram-readiness.ts --json
 *
 * Exit code:
 *   0  — all required signals present, Phase 5 adapter coding can start
 *   1  — at least one required signal missing
 *   2  — probe itself failed (unexpected error)
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { parseArgs } from "util";

interface Check {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  required: boolean;
}

const REQUIRED_MCP_TOOLS = [
  "mcp__engram__write_compost_insight",
  "mcp__engram__stream_for_compost",
  "mcp__engram__invalidate_compost_fact",
];

const REQUIRED_ENGRAM_FILES = [
  "tests/test_api_surface_coverage.py",
  "docs/non-exposed-schema-fields.md",
];

function checkEngramCli(): Check {
  const proc = Bun.spawnSync(["which", "engram"]);
  const pass = proc.exitCode === 0;
  return {
    id: "engram-cli",
    label: "Engram CLI on PATH",
    pass,
    detail: pass ? proc.stdout.toString().trim() : "engram not found in PATH",
    required: false,
  };
}

function checkEngramDb(): Check[] {
  const dbPath = process.env["ENGRAM_DB"]
    ? resolve(process.env["ENGRAM_DB"])
    : join(homedir(), ".engram", "engram.db");

  if (!existsSync(dbPath)) {
    return [
      {
        id: "engram-db-exists",
        label: "Engram database file",
        pass: false,
        detail: `not found at ${dbPath}`,
        required: false,
      },
    ];
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const checks: Check[] = [];

    checks.push({
      id: "engram-db-exists",
      label: "Engram database file",
      pass: true,
      detail: dbPath,
      required: false,
    });

    // origin=compost CHECK constraint (debate 019)
    const tableRow = db
      .query(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'"
      )
      .get() as { sql?: string } | null;
    const memoriesSql = tableRow?.sql ?? "";
    const hasCompostOrigin = /origin\s+IN\s*\([^)]*'compost'/i.test(
      memoriesSql
    );
    checks.push({
      id: "schema-origin-compost",
      label: "memories.origin CHECK includes 'compost'",
      pass: hasCompostOrigin,
      detail: hasCompostOrigin
        ? "CHECK(origin IN ('human','agent','compost')) present"
        : "CHECK missing or does not include 'compost'",
      required: true,
    });

    // compost_cache table DDL
    const cacheRow = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='compost_cache'"
      )
      .get() as { name?: string } | null;
    const hasCompostCache = Boolean(cacheRow?.name);
    checks.push({
      id: "schema-compost-cache",
      label: "compost_cache table exists (debate 016 DDL)",
      pass: hasCompostCache,
      detail: hasCompostCache
        ? "table present"
        : "table missing (Engram Phase 2 not yet landed)",
      required: false, // compost_cache is reserved DDL per debate 018 — nice-to-have
    });

    // scope column + CHECK
    const cols = db
      .query("PRAGMA table_info(memories)")
      .all() as Array<{ name: string }>;
    const hasScope = cols.some((c) => c.name === "scope");
    checks.push({
      id: "schema-scope-column",
      label: "memories.scope column exists",
      pass: hasScope,
      detail: hasScope
        ? "scope column present"
        : "scope column missing (Engram Slice A not yet migrated locally)",
      required: true,
    });

    // expires_at column (Phase 2 drift-fix)
    const hasExpiresAt = cols.some((c) => c.name === "expires_at");
    checks.push({
      id: "schema-expires-at",
      label: "memories.expires_at column exists",
      pass: hasExpiresAt,
      detail: hasExpiresAt
        ? "expires_at present"
        : "expires_at missing (Engram Phase 2 drift fix pending)",
      required: true,
    });

    // source_trace column
    const hasSourceTrace = cols.some((c) => c.name === "source_trace");
    checks.push({
      id: "schema-source-trace",
      label: "memories.source_trace column exists",
      pass: hasSourceTrace,
      detail: hasSourceTrace
        ? "source_trace present"
        : "source_trace missing (Engram Phase 2 drift fix pending)",
      required: true,
    });

    db.close();
    return checks;
  } catch (e) {
    return [
      {
        id: "engram-db-exists",
        label: "Engram database readable",
        pass: false,
        detail: `open failed: ${e instanceof Error ? e.message : String(e)}`,
        required: false,
      },
    ];
  }
}

function checkEngramRepo(repoPath: string | undefined): Check[] {
  if (!repoPath) {
    return [
      {
        id: "engram-repo",
        label: "Engram repo path",
        pass: false,
        detail:
          "not provided (pass --engram-repo ../Engram to probe repo files)",
        required: false,
      },
    ];
  }

  const abs = resolve(repoPath);
  if (!existsSync(abs)) {
    return [
      {
        id: "engram-repo",
        label: "Engram repo clone",
        pass: false,
        detail: `not found at ${abs}`,
        required: false,
      },
    ];
  }

  const checks: Check[] = [
    {
      id: "engram-repo",
      label: "Engram repo clone",
      pass: true,
      detail: abs,
      required: false,
    },
  ];

  for (const rel of REQUIRED_ENGRAM_FILES) {
    const full = join(abs, rel);
    const exists = existsSync(full);
    checks.push({
      id: `engram-file:${rel}`,
      label: `${rel}`,
      pass: exists,
      detail: exists ? full : "not present (Engram Phase 2 not landed)",
      required: true,
    });
  }

  return checks;
}

function checkMcpTools(): Check[] {
  // Compost has no direct MCP introspection. This probe checks the contract
  // doc's declared tool list — the actual availability check must happen in
  // an agent session with MCP access (Claude Code's ToolSearch), or by
  // invoking a tool and catching the MethodNotFound error.
  //
  // We still emit the expected-tool manifest so the operator can cross-check
  // by hand or pipe to a downstream agent.
  return REQUIRED_MCP_TOOLS.map((tool) => ({
    id: `mcp:${tool}`,
    label: `MCP tool declared: ${tool}`,
    pass: false,
    detail:
      "probe cannot call MCP directly — verify in an agent session via ToolSearch",
    required: true,
  }));
}

function main(): never {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "engram-repo": { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const checks: Check[] = [
    checkEngramCli(),
    ...checkEngramDb(),
    ...checkEngramRepo(values["engram-repo"]),
    ...checkMcpTools(),
  ];

  const requiredMissing = checks.filter((c) => c.required && !c.pass);
  const status: "ready" | "blocked" =
    requiredMissing.length === 0 ? "ready" : "blocked";

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          status,
          required_missing: requiredMissing.length,
          checks,
        },
        null,
        2
      )
    );
  } else {
    console.log("Phase 5 Engram readiness probe");
    console.log("=".repeat(48));
    for (const c of checks) {
      const icon = c.pass ? "✓" : c.required ? "✗" : "·";
      const tag = c.required ? "[required]" : "[optional]";
      console.log(`${icon} ${tag} ${c.label}`);
      console.log(`    ${c.detail}`);
    }
    console.log("=".repeat(48));
    console.log(
      status === "ready"
        ? "STATUS: READY — Phase 5 adapter coding can begin."
        : `STATUS: BLOCKED — ${requiredMissing.length} required signal(s) missing.`
    );
  }

  // eslint-disable-next-line no-process-exit
  process.exit(status === "ready" ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
