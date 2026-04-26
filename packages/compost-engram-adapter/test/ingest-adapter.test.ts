import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import {
  ENGRAM_ADAPTER,
  ENGRAM_SOURCE_ID,
  defaultSpoMapper,
  ensureEngramSource,
  ingestEngramEntry,
} from "../src/ingest-adapter";
import type { EngramStreamEntry } from "../src/stream-puller";

function freshDb(tmpDir: string): Database {
  const db = new Database(join(tmpDir, "ledger.db"));
  applyMigrations(db);
  ensureEngramSource(db);
  return db;
}

function entry(overrides: Partial<EngramStreamEntry> = {}): EngramStreamEntry {
  return {
    memory_id: "mem-1",
    kind: "preference",
    content: "I prefer Go over Python for CLI tools.",
    project: "compost",
    scope: "project",
    created_at: "2026-04-17T00:00:00Z",
    updated_at: "2026-04-17T00:00:00Z",
    tags: ["preferences"],
    origin: "human",
    ...overrides,
  };
}

describe("ensureEngramSource", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-ingest-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("seeds source row once; subsequent calls are no-ops", () => {
    const db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    ensureEngramSource(db);
    ensureEngramSource(db);
    const rows = db
      .query("SELECT * FROM source WHERE id = ?")
      .all(ENGRAM_SOURCE_ID) as Array<{ id: string; kind: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("sensory");
    db.close();
  });
});

describe("defaultSpoMapper", () => {
  test("maps known kinds to stable predicates", () => {
    expect(defaultSpoMapper(entry({ kind: "preference" }))[0]?.predicate).toBe(
      "prefers"
    );
    expect(defaultSpoMapper(entry({ kind: "goal" }))[0]?.predicate).toBe(
      "aims-at"
    );
    expect(defaultSpoMapper(entry({ kind: "habit" }))[0]?.predicate).toBe(
      "habitually"
    );
    expect(defaultSpoMapper(entry({ kind: "person" }))[0]?.predicate).toBe(
      "knows-person"
    );
    expect(defaultSpoMapper(entry({ kind: "note" }))[0]?.predicate).toBe(
      "noted"
    );
    expect(defaultSpoMapper(entry({ kind: "event" }))[0]?.predicate).toBe(
      "experienced"
    );
    expect(defaultSpoMapper(entry({ kind: "reflection" }))[0]?.predicate).toBe(
      "reflected"
    );
  });

  test("falls back to raw kind for unknown predicate", () => {
    const triples = defaultSpoMapper(entry({ kind: "exotic_kind" }));
    expect(triples[0]?.predicate).toBe("exotic_kind");
  });

  test("subject is project when entry.project is set (R3 fix 2026-04-25)", () => {
    const t = defaultSpoMapper(
      entry({ kind: "preference", content: "prefers Go", project: "compost" })
    )[0];
    expect(t?.subject).toBe("compost");
    expect(t?.object).toBe("prefers Go");
  });

  test("scope='global' with null project → subject='global'", () => {
    const t = defaultSpoMapper(
      entry({ kind: "fact", project: null, scope: "global", content: "x" })
    )[0];
    expect(t?.subject).toBe("global");
  });

  test("scope='meta' with null project → subject='meta' (cross-cutting user model)", () => {
    const t = defaultSpoMapper(
      entry({ kind: "preference", project: null, scope: "meta", content: "x" })
    )[0];
    expect(t?.subject).toBe("meta");
  });

  test("subject falls back to 'user' only when neither project nor recognized scope", () => {
    // scope='project' but project=null is technically illegal per Engram
    // CHECK constraint, but defaultSpoMapper guards anyway.
    const t = defaultSpoMapper(
      entry({ kind: "fact", project: null, scope: "project", content: "x" })
    )[0];
    expect(t?.subject).toBe("user");
  });

  test("different projects → different subjects (cross-project differentiation)", () => {
    const a = defaultSpoMapper(entry({ project: "athena" }))[0];
    const b = defaultSpoMapper(entry({ project: "relay" }))[0];
    const c = defaultSpoMapper(entry({ project: "compost" }))[0];
    expect(a?.subject).toBe("athena");
    expect(b?.subject).toBe("relay");
    expect(c?.subject).toBe("compost");
    expect(new Set([a?.subject, b?.subject, c?.subject]).size).toBe(3);
  });
});

describe("ingestEngramEntry", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-ingest-"));
    db = freshDb(tmpDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("new entry → observation + fact + chunk rows inserted", async () => {
    const r = await ingestEngramEntry(db, entry());
    expect(r.inserted).toBe("new");
    expect(r.fact_count).toBe(1);
    expect(r.chunk_count).toBe(1);

    const obs = db
      .query("SELECT * FROM observations WHERE observe_id = ?")
      .get(r.observe_id) as {
      source_id: string;
      adapter: string;
      idempotency_key: string;
      trust_tier: string;
      origin_hash: string | null;
      method: string | null;
      mime_type: string;
    };
    expect(obs.source_id).toBe(ENGRAM_SOURCE_ID);
    expect(obs.adapter).toBe(ENGRAM_ADAPTER);
    expect(obs.idempotency_key).toBe("engram:mem-1");
    expect(obs.trust_tier).toBe("user");
    expect(obs.origin_hash).not.toBeNull();
    expect(obs.method).toBe("engram");
    expect(obs.mime_type).toBe("application/json");

    const fact = db
      .query("SELECT subject, predicate, object FROM facts WHERE observe_id = ?")
      .get(r.observe_id) as {
      subject: string;
      predicate: string;
      object: string;
    };
    // R3 fix 2026-04-25: subject derives from project (was hard-coded "user").
    // Fixture in entry() at line 28 sets project: "compost".
    expect(fact.subject).toBe("compost");
    expect(fact.predicate).toBe("prefers");
    expect(fact.object).toBe("I prefer Go over Python for CLI tools.");

    const chunk = db
      .query(
        "SELECT chunk_index, text_content, transform_policy FROM chunks WHERE observe_id = ?"
      )
      .get(r.observe_id) as {
      chunk_index: number;
      text_content: string;
      transform_policy: string;
    };
    expect(chunk.chunk_index).toBe(0);
    expect(chunk.text_content).toBe("I prefer Go over Python for CLI tools.");
  });

  test("agent origin → trust_tier=first_party", async () => {
    const r = await ingestEngramEntry(db, entry({ origin: "agent" }));
    const row = db
      .query("SELECT trust_tier FROM observations WHERE observe_id = ?")
      .get(r.observe_id) as { trust_tier: string };
    expect(row.trust_tier).toBe("first_party");
  });

  test("duplicate memory_id → returns existing observe_id, no new rows", async () => {
    const first = await ingestEngramEntry(db, entry());
    const second = await ingestEngramEntry(db, entry());
    expect(second.inserted).toBe("duplicate");
    expect(second.observe_id).toBe(first.observe_id);

    const obsCount = db
      .query("SELECT COUNT(*) AS n FROM observations")
      .get() as { n: number };
    const factCount = db
      .query("SELECT COUNT(*) AS n FROM facts")
      .get() as { n: number };
    expect(obsCount.n).toBe(1);
    expect(factCount.n).toBe(1);
  });

  test("metadata JSON round trip carries engram fields", async () => {
    const r = await ingestEngramEntry(
      db,
      entry({
        tags: ["a", "b"],
        origin: "human",
        scope: "project",
        updated_at: "2026-04-17T12:00:00Z",
      })
    );
    const row = db
      .query("SELECT metadata FROM observations WHERE observe_id = ?")
      .get(r.observe_id) as { metadata: string };
    const meta = JSON.parse(row.metadata);
    expect(meta.engram_kind).toBe("preference");
    expect(meta.engram_project).toBe("compost"); // R3 fix 2026-04-25
    expect(meta.engram_scope).toBe("project");
    expect(meta.engram_tags).toEqual(["a", "b"]);
    expect(meta.engram_origin).toBe("human");
    expect(meta.engram_updated_at).toBe("2026-04-17T12:00:00Z");
  });

  test("custom spoMapper override emits user-defined triples", async () => {
    const r = await ingestEngramEntry(db, entry({ kind: "event" }), {
      spoMapper: (e) => [
        { subject: "sprint-2026-W16", predicate: "contains-event", object: e.content },
      ],
    });
    const fact = db
      .query("SELECT subject, predicate FROM facts WHERE observe_id = ?")
      .get(r.observe_id) as { subject: string; predicate: string };
    expect(fact.subject).toBe("sprint-2026-W16");
    expect(fact.predicate).toBe("contains-event");
  });

  test("origin_hash is SHA-256 of adapter|source_uri|idempotency_key (Migration 0014 contract)", async () => {
    const r = await ingestEngramEntry(db, entry({ memory_id: "mem-xyz" }));
    const row = db
      .query("SELECT origin_hash FROM observations WHERE observe_id = ?")
      .get(r.observe_id) as { origin_hash: string };
    // Compute expected
    const expected = require("crypto")
      .createHash("sha256")
      .update("engram|engram://memory/mem-xyz|engram:mem-xyz")
      .digest("hex");
    expect(row.origin_hash).toBe(expected);
  });

  test("cascade delete: removing observation GCs facts + chunks", async () => {
    const r = await ingestEngramEntry(db, entry());
    db.run("DELETE FROM observations WHERE observe_id = ?", [r.observe_id]);
    const facts = db.query("SELECT COUNT(*) AS n FROM facts").get() as {
      n: number;
    };
    const chunks = db.query("SELECT COUNT(*) AS n FROM chunks").get() as {
      n: number;
    };
    expect(facts.n).toBe(0);
    expect(chunks.n).toBe(0);
  });
});
