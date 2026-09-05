#!/usr/bin/env bun
/**
 * Phase 5 gate: probe whether Engram is ready for `compost-engram-adapter`
 * implementation to begin.
 *
 * Per Engram handover `af46ee1753a1` (v3.4 Slice B Phase 2 S2 complete,
 * main @ ea223fa), the three write/read/invalidate surfaces Compost
 * needs are:
 *
 *   remember(origin='compost', kind='insight', ...)   [reused existing tool]
 *   stream_for_compost(since, kinds, project, ...)    [new]
 *   invalidate_compost_fact(fact_ids[])               [new]
 *
 * Plus the API-surface invariant test and drift-whitelist doc on the
 * Engram side:
 *
 *   tests/test_api_surface_coverage.py  (Engram repo)
 *   docs/non-exposed-schema-fields.md   (Engram repo)
 *
 * Schema side (already shipped in Engram v3.3 / v3.4 Slice A):
 *   memories.origin CHECK includes 'compost'
 *   memories.scope column present
 *   memories.expires_at column present
 *   memories.source_trace column present
 *   compost_cache table DDL present
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
 *
 * MCP readiness is verified by a read-only stdio handshake and tools/list.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, } from "fs";
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

// Two new MCP tools from Engram v3.4 Slice B Phase 2 S2. The write path
// reuses the existing `mcp__engram__remember` with `origin='compost'`;
// Engram's `_map_insight_sources` auto-fills the insight-sources table.
const REQUIRED_MCP_TOOLS = [
  "stream_for_compost",
  "states_for_compost",
  "invalidate_compost_fact",
];

// The write path reuses an existing tool. Verified via its schema description
// (must mention `compost` in the origin vocabulary).
const REUSED_WRITE_TOOL = "remember";

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

export async function checkMcpTools(command = "engram-server"): Promise<Check[]> {
  const client = new Client({ name: "compost-readiness", version: "0.1.0" });
  const transport = new StdioClientTransport({ command, stderr: "pipe" });
  const checks: Check[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const manifest = await Promise.race([
      (async () => {
        await client.connect(transport);
        return await client.listTools();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("MCP handshake exceeded 10 seconds")), 10_000);
      }),
    ]);
    for (const name of REQUIRED_MCP_TOOLS) {
      const tool = manifest.tools.find((t) => t.name === name);
      const pass = !!tool && (name !== "stream_for_compost" || !!tool.inputSchema.properties?.["after_id"]);
      checks.push({ id: `mcp:${name}`, label: `MCP tool: ${name}`, pass,
        detail: pass ? "verified via tools/list" : "tool or pagination contract missing", required: true });
    }
    const remember = manifest.tools.find((t) => t.name === REUSED_WRITE_TOOL);
    const supportsOrigin = !!remember?.inputSchema.properties?.["origin"] &&
      JSON.stringify(remember).includes("compost");
    checks.push({ id: "mcp:remember-compost-origin", label: "remember supports Compost origin",
      pass: supportsOrigin, detail: supportsOrigin ? "verified in tool schema/description" : "origin contract missing", required: true });
  } catch (error) {
    checks.push({ id: "mcp:connection", label: "Engram MCP connection", pass: false,
      detail: error instanceof Error ? error.message : String(error), required: true });
  } finally {
    if (timer) clearTimeout(timer);
    await client.close();
    await transport.close();
  }
  return checks;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "engram-repo": { type: "string" },
      "engram-server-bin": { type: "string", default: "engram-server" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const checks: Check[] = [
    checkEngramCli(),
    ...checkEngramDb(),
    ...checkEngramRepo(values["engram-repo"]),
    ...await checkMcpTools(values["engram-server-bin"]),
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
    console.log("Compost / Engram readiness probe");
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
        ? "STATUS: READY — integration contracts verified."
        : `STATUS: BLOCKED — ${requiredMissing.length} required signal(s) missing.`
    );
  }

  // eslint-disable-next-line no-process-exit
  process.exit(status === "ready" ? 0 : 1);
}

if (import.meta.main) try {
  await main();
} catch (e) {
  console.error(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
