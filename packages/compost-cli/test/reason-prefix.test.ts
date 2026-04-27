import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { resolveChainIdPrefix } from "../src/commands/reason";

function openTestDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "compost-prefix-"));
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return { db, dir };
}

function seedChain(db: Database, chainId: string): void {
  db.run(
    `INSERT INTO reasoning_chains (
       chain_id, seed_kind, seed_id, policy_version,
       candidate_fact_ids_json, retrieval_trace_json, answer_json, confidence,
       created_at
     ) VALUES (?, 'fact', 'subject-x', 'l5-test',
       '[]', '{}', '{"chain":null,"confidence":0.5}', 0.5,
       datetime('now'))`,
    [chainId]
  );
}

describe("resolveChainIdPrefix", () => {
  let db: Database;
  let dir: string;

  beforeEach(() => {
    const ctx = openTestDb();
    db = ctx.db;
    dir = ctx.dir;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns full UUID unchanged when input is 36 chars", () => {
    const full = "356965c5-4482-5d84-be0c-65c9207c0d06";
    seedChain(db, full);
    expect(resolveChainIdPrefix(db, full)).toBe(full);
  });

  it("resolves a unique prefix to the full chain_id", () => {
    const full = "356965c5-4482-5d84-be0c-65c9207c0d06";
    seedChain(db, full);
    seedChain(db, "a8faabfe-29ca-5c08-8a43-d0c478702778");
    expect(resolveChainIdPrefix(db, "356965c5")).toBe(full);
  });

  it("throws on ambiguous prefix matching multiple chains", () => {
    seedChain(db, "abcd1234-aaaa-5555-bbbb-1111aaaa0001");
    seedChain(db, "abcd1234-bbbb-6666-cccc-2222bbbb0002");
    expect(() => resolveChainIdPrefix(db, "abcd1234")).toThrow(/ambiguous/);
  });

  it("throws on prefix that matches no chain", () => {
    seedChain(db, "356965c5-4482-5d84-be0c-65c9207c0d06");
    expect(() => resolveChainIdPrefix(db, "deadbeef")).toThrow(/no chain_id matches/);
  });

  it("throws on prefix shorter than 4 chars", () => {
    seedChain(db, "356965c5-4482-5d84-be0c-65c9207c0d06");
    expect(() => resolveChainIdPrefix(db, "356")).toThrow(/prefix too short/);
  });
});
