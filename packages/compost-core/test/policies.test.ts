import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  policies,
  upsertPolicies,
  validatePolicyExists,
  getActivePolicy,
} from "../src/policies/registry";

describe("policies/registry", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-policy-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("policies registry contains tp-2026-04", () => {
    expect(policies["tp-2026-04"]).toBeDefined();
    expect(policies["tp-2026-04"].id).toBe("tp-2026-04");
    expect(policies["tp-2026-04"].supersedes).toBeNull();
    expect(policies["tp-2026-04"].effective_from).toBe("2026-04-01");
    expect(policies["tp-2026-04"].chunk.size).toBe(800);
    expect(policies["tp-2026-04"].chunk.overlap).toBe(100);
    expect(policies["tp-2026-04"].extraction.timeoutSec).toBe(120);
    expect(policies["tp-2026-04"].extraction.maxRetries).toBe(3);
    expect(policies["tp-2026-04"].migration_notes).toBe(
      "Initial Phase 0 policy."
    );
  });

  test("upsertPolicies inserts all registry entries into SQL policies table", () => {
    upsertPolicies(db);

    const rows = db.query("SELECT * FROM policies").all() as Array<{
      policy_id: string;
      supersedes: string | null;
      effective_from: string;
      definition_json: string;
      migration_notes: string | null;
    }>;

    expect(rows).toHaveLength(Object.keys(policies).length);

    const row = rows.find((r) => r.policy_id === "tp-2026-04")!;
    expect(row).toBeDefined();
    expect(row.supersedes).toBeNull();
    expect(row.effective_from).toBe("2026-04-01");
    expect(row.migration_notes).toBe("Initial Phase 0 policy.");

    const def = JSON.parse(row.definition_json);
    expect(def.chunk.size).toBe(800);
    expect(def.extraction.timeoutSec).toBe(120);
  });

  test("upsertPolicies is idempotent", () => {
    upsertPolicies(db);
    upsertPolicies(db);

    const rows = db.query("SELECT * FROM policies").all();
    expect(rows).toHaveLength(Object.keys(policies).length);
  });

  test("upsertPolicies updates definition_json on re-run if content changed", () => {
    upsertPolicies(db);

    // Simulate an external change to verify upsert overwrites
    db.run(
      "UPDATE policies SET definition_json = '{}' WHERE policy_id = 'tp-2026-04'"
    );

    upsertPolicies(db);

    const row = db
      .query(
        "SELECT definition_json FROM policies WHERE policy_id = 'tp-2026-04'"
      )
      .get() as { definition_json: string };
    const def = JSON.parse(row.definition_json);
    expect(def.chunk.size).toBe(800);
  });

  test("validatePolicyExists passes for registered policy", () => {
    upsertPolicies(db);
    expect(() => validatePolicyExists(db, "tp-2026-04")).not.toThrow();
  });

  test("validatePolicyExists throws for unknown policy", () => {
    upsertPolicies(db);
    expect(() => validatePolicyExists(db, "tp-2026-99")).toThrow(
      /tp-2026-99.*not registered/
    );
  });

  test("validatePolicyExists throws even without upsert", () => {
    expect(() => validatePolicyExists(db, "tp-2026-04")).toThrow(
      /not registered/
    );
  });

  test("getActivePolicy returns the latest non-superseded policy", () => {
    upsertPolicies(db);
    const active = getActivePolicy();
    expect(active.id).toBe("tp-2026-04-03");
  });
});
