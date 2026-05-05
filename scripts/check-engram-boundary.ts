#!/usr/bin/env bun
/**
 * Guard the Compost/Engram split while the projects stay in separate repos.
 *
 * This is intentionally lightweight: it checks package dependencies and a
 * small set of direct-coupling source patterns. It does not decide whether
 * Engram is installed or whether MCP tools are live; use
 * scripts/probe-engram-readiness.ts for that runtime readiness check.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, relative } from "path";

interface Violation {
  path: string;
  message: string;
}

interface PackageRule {
  manifest: string;
  disallowedDeps: string[];
}

const ROOT = process.cwd();

const packageRules: PackageRule[] = [
  {
    manifest: "package.json",
    disallowedDeps: ["compost-engram-adapter", "@modelcontextprotocol/sdk"],
  },
  {
    manifest: "packages/compost-core/package.json",
    disallowedDeps: ["compost-engram-adapter", "@modelcontextprotocol/sdk"],
  },
  {
    manifest: "packages/compost-hook-shim/package.json",
    disallowedDeps: ["compost-engram-adapter", "@modelcontextprotocol/sdk"],
  },
  {
    manifest: "packages/compost-engram-adapter/package.json",
    disallowedDeps: ["compost-core", "compost-daemon", "compost-cli"],
  },
];

const forbiddenSourceRoots = [
  "packages/compost-core/src",
  "packages/compost-hook-shim/src",
];

const forbiddenPatterns: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /from\s+["']compost-engram-adapter["']/,
    label: "direct import from compost-engram-adapter",
  },
  {
    pattern: /@modelcontextprotocol\/sdk/,
    label: "direct MCP SDK dependency",
  },
  {
    pattern: /mcp__engram__/,
    label: "direct Engram MCP tool coupling",
  },
  {
    pattern: /StdioEngramMcpClient|EngramMcpClient/,
    label: "direct Engram MCP client coupling",
  },
  {
    pattern: /engram-server|ENGRAM_DB|stream_for_compost/,
    label: "direct Engram runtime coupling",
  },
  {
    pattern: /\/Users\/zion\/Repos\/Zylo\/Engram/,
    label: "absolute Engram repo path",
  },
];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function dependencySections(pkg: Record<string, unknown>): Array<Record<string, string>> {
  return [
    pkg["dependencies"],
    pkg["devDependencies"],
    pkg["peerDependencies"],
    pkg["optionalDependencies"],
  ].filter((section): section is Record<string, string> => {
    return Boolean(section) && typeof section === "object";
  });
}

function checkPackageRules(): Violation[] {
  const violations: Violation[] = [];

  for (const rule of packageRules) {
    const full = join(ROOT, rule.manifest);
    if (!existsSync(full)) {
      violations.push({
        path: rule.manifest,
        message: "manifest missing",
      });
      continue;
    }

    const pkg = readJson(full);
    const deps = dependencySections(pkg);
    for (const disallowed of rule.disallowedDeps) {
      if (deps.some((section) => Object.hasOwn(section, disallowed))) {
        violations.push({
          path: rule.manifest,
          message: `forbidden dependency on ${disallowed}`,
        });
      }
    }
  }

  return violations;
}

function walkTsFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];

  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }

  return out;
}

function checkSourcePatterns(): Violation[] {
  const violations: Violation[] = [];

  for (const root of forbiddenSourceRoots) {
    for (const file of walkTsFiles(join(ROOT, root))) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, label } of forbiddenPatterns) {
        if (pattern.test(text)) {
          violations.push({
            path: relative(ROOT, file),
            message: label,
          });
        }
      }
    }
  }

  return violations;
}

function main(): never {
  const violations = [...checkPackageRules(), ...checkSourcePatterns()];

  console.log("Compost/Engram boundary check");
  console.log("=".repeat(40));

  if (violations.length === 0) {
    console.log("PASS: no boundary drift detected.");
    process.exit(0);
  }

  for (const violation of violations) {
    console.log(`FAIL: ${violation.path}`);
    console.log(`  ${violation.message}`);
  }
  console.log("=".repeat(40));
  console.log(`FAILED: ${violations.length} violation(s) found.`);
  process.exit(1);
}

main();
