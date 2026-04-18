import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  CORRECTION_PATTERNS,
  MAX_RETRACTED_TEXT_CHARS,
  detectCorrection,
  recordCorrection,
  findRelatedFacts,
  scanObservationForCorrection,
} from "../src/cognitive/correction-detector";

describe("correction-detector (P0-5, Phase 4 Batch D)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-correction-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("correction_events table exists", () => {
    const cols = db
      .query("PRAGMA table_info('correction_events')")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual([
      "corrected_text",
      "created_at",
      "id",
      "pattern_matched",
      "processed_at",
      "related_fact_ids_json",
      "retracted_text",
      "session_id",
    ]);
  });

  test("CORRECTION_PATTERNS exports at least 5 patterns covering ZH + EN", () => {
    expect(CORRECTION_PATTERNS.length).toBeGreaterThanOrEqual(5);
    const names = CORRECTION_PATTERNS.map((p) => p.name);
    expect(names.some((n) => n.startsWith("zh."))).toBe(true);
    expect(names.some((n) => n.startsWith("en."))).toBe(true);
  });

  test("detectCorrection matches Chinese self-correction", () => {
    const result = detectCorrection("我之前说的 X 是错的, 实际上应该是 Y");
    expect(result).not.toBeNull();
    expect(result!.patternName).toMatch(/zh\./);
  });

  test("detectCorrection matches English self-correction", () => {
    const result = detectCorrection("Wait, I was wrong about the migration count");
    expect(result).not.toBeNull();
    expect(result!.patternName).toMatch(/en\./);
  });

  test("detectCorrection returns null on neutral text", () => {
    expect(detectCorrection("The weather is nice today.")).toBeNull();
    expect(detectCorrection("讨论一下这个 PR 的设计")).toBeNull();
  });

  // ---- P0-5 Week 2 implementation tests ----

  test("detectCorrection stores full turn text (not match[0])", () => {
    const turn = "Paris is in France. I was wrong about saying it was in Germany.";
    const result = detectCorrection(turn);
    expect(result).not.toBeNull();
    expect(result!.retractedText).toBe(turn); // full text, not just "I was wrong about"
    expect(result!.retractedText).not.toBe("I was wrong about");
  });

  test("detectCorrection truncates retractedText at MAX_RETRACTED_TEXT_CHARS", () => {
    const longPrefix = "x".repeat(MAX_RETRACTED_TEXT_CHARS);
    const turn = longPrefix + " I was wrong about the thing";
    const result = detectCorrection(turn);
    expect(result).not.toBeNull();
    expect(result!.retractedText.length).toBe(MAX_RETRACTED_TEXT_CHARS);
  });

  test("recordCorrection inserts correction_events + health_signals transactionally", () => {
    const { id } = recordCorrection(db, {
      sessionId: "sess-1",
      retractedText: "I was wrong about the capital",
      correctedText: null,
      patternName: "en.i_was_wrong",
      relatedFactIds: ["f1", "f2"],
    });
    expect(id).toBeGreaterThan(0);

    const event = db
      .query(
        "SELECT session_id, retracted_text, pattern_matched, processed_at, related_fact_ids_json FROM correction_events WHERE id = ?"
      )
      .get(id) as {
      session_id: string;
      retracted_text: string;
      pattern_matched: string;
      processed_at: string;
      related_fact_ids_json: string;
    };
    expect(event.session_id).toBe("sess-1");
    expect(event.pattern_matched).toBe("en.i_was_wrong");
    expect(event.processed_at).not.toBeNull(); // step 3 of transaction
    expect(JSON.parse(event.related_fact_ids_json)).toEqual(["f1", "f2"]);

    const signal = db
      .query(
        "SELECT kind, severity, target_ref FROM health_signals WHERE target_ref = ?"
      )
      .get(`correction_event:${id}`) as {
      kind: string;
      severity: string;
      target_ref: string;
    };
    expect(signal.kind).toBe("correction_candidate");
    expect(signal.severity).toBe("info");
    expect(signal.target_ref).toBe(`correction_event:${id}`);
  });

  test("recordCorrection with empty relatedFactIds still works", () => {
    const { id } = recordCorrection(db, {
      sessionId: null,
      retractedText: "scratch that",
      correctedText: null,
      patternName: "en.scratch_that",
    });
    const event = db
      .query("SELECT related_fact_ids_json FROM correction_events WHERE id = ?")
      .get(id) as { related_fact_ids_json: string };
    expect(JSON.parse(event.related_fact_ids_json)).toEqual([]);
  });

  describe("findRelatedFacts (Option A — tokenize + session-filter + overlap)", () => {
    function seedClaudeCodeFact(
      factId: string,
      subject: string,
      obj: string,
      sessionId: string = "sess-1"
    ): void {
      const sourceId = `claude-code:${sessionId}:/tmp/x`;
      // Idempotent source seed — tests may call this multiple times per session.
      db.run(
        "INSERT OR IGNORE INTO source VALUES (?,?,?,NULL,0.0,'first_party',datetime('now'),NULL)",
        [sourceId, `claude-code://${sessionId}`, "claude-code"]
      );
      db.run(
        "INSERT INTO observations VALUES (?,?,?,datetime('now'),datetime('now'),'h','r',NULL,NULL,'application/json','claude-code',1,'first_party',?,'tp-2026-04',NULL,NULL,NULL)",
        [`obs-${factId}`, sourceId, `claude-code://${sessionId}`, `idem-${factId}`]
      );
      db.run(
        "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES (?, ?, 'pred', ?, ?)",
        [factId, subject, obj, `obs-${factId}`]
      );
    }

    test("empty retractedText yields empty result", () => {
      expect(findRelatedFacts(db, "", { sessionId: "sess-1" })).toEqual([]);
    });

    test("retractedText with only stopwords yields empty (no signal)", () => {
      expect(findRelatedFacts(db, "is a the", { sessionId: "sess-1" })).toEqual([]);
    });

    test("session filter: matches within-session facts via LIKE 'claude-code:<sid>:%'", () => {
      seedClaudeCodeFact("f1", "Redis", "persistence store");
      seedClaudeCodeFact("f-other", "Redis", "persistence store", "sess-2");
      const result = findRelatedFacts(
        db,
        "I was wrong about Redis persistence store",
        { sessionId: "sess-1", minTokenOverlap: 2 }
      );
      expect(result).toEqual(["f1"]);
    });

    test("minTokenOverlap cutoff excludes weakly-overlapping facts", () => {
      seedClaudeCodeFact("f-strong", "Redis persistence", "durable store");
      seedClaudeCodeFact("f-weak", "Postgres", "replication");
      const result = findRelatedFacts(
        db,
        "Redis persistence store is durable",
        { sessionId: "sess-1", minTokenOverlap: 2 }
      );
      // f-strong shares {redis, persistence, durable, store} ≥ 2 overlap
      // f-weak shares nothing
      expect(result).toEqual(["f-strong"]);
    });

    test("results sorted by overlap desc and capped at limit", () => {
      seedClaudeCodeFact("f-big", "Redis persistence durable", "store mechanism");
      seedClaudeCodeFact("f-mid", "Redis persistence", "memory");
      seedClaudeCodeFact("f-small", "Redis usage", "xyz");
      const result = findRelatedFacts(
        db,
        "Redis persistence durable store mechanism",
        { sessionId: "sess-1", minTokenOverlap: 2, limit: 2 }
      );
      expect(result).toEqual(["f-big", "f-mid"]);
    });

    test("archived / superseded facts excluded", () => {
      seedClaudeCodeFact("f-live", "Redis persistence", "store");
      seedClaudeCodeFact("f-archived", "Redis persistence", "store");
      db.run("UPDATE facts SET archived_at = datetime('now') WHERE fact_id = 'f-archived'");
      seedClaudeCodeFact("f-superseded", "Redis persistence", "store");
      db.run("UPDATE facts SET superseded_by = 'f-live' WHERE fact_id = 'f-superseded'");
      const result = findRelatedFacts(
        db,
        "Redis persistence store was wrong",
        { sessionId: "sess-1", minTokenOverlap: 2 }
      );
      expect(result).toEqual(["f-live"]);
    });

    test("without sessionId: falls back to recent global pool (7d window)", () => {
      // Non-claude-code source to prove the global fallback reaches it
      db.run(
        "INSERT INTO source VALUES ('file-src','file:///a.md','local-file',NULL,0.0,'user',datetime('now'),NULL)"
      );
      db.run(
        "INSERT INTO observations VALUES ('obs-g','file-src','file:///a.md',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','test',1,'user','idem-g','tp-2026-04',NULL,NULL,NULL)"
      );
      db.run(
        "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('f-global','Redis','uses','persistence store','obs-g')"
      );
      const result = findRelatedFacts(db, "Redis persistence store wrong", {
        minTokenOverlap: 2,
      });
      expect(result).toContain("f-global");
    });
  });

  test("scanObservationForCorrection detects a claude-code hook correction", () => {
    // Seed source + observation with a hook envelope that contains user text
    db.run(
      "INSERT INTO source VALUES ('claude-code:sess-1:/tmp/x','claude-code://sess-1','claude-code',NULL,0.0,'first_party',datetime('now'),NULL)"
    );
    const envelope = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-1",
      cwd: "/tmp/x",
      timestamp: "2026-04-15T10:00:00Z",
      payload: {
        prompt: "Paris is in France. Actually, I was wrong about the capital.",
      },
    };
    db.run(
      "INSERT INTO observations VALUES ('obs-corr','claude-code:sess-1:/tmp/x','claude-code://sess-1',datetime('now'),datetime('now'),'h','r',?,NULL,'application/json','claude-code',1,'first_party','idem-corr','tp-2026-04',NULL,NULL,NULL)",
      [Buffer.from(JSON.stringify(envelope))]
    );

    const result = scanObservationForCorrection(db, "obs-corr");
    expect(result.eventId).not.toBeNull();

    const event = db
      .query(
        "SELECT session_id, pattern_matched FROM correction_events WHERE id = ?"
      )
      .get(result.eventId) as { session_id: string; pattern_matched: string };
    expect(event.session_id).toBe("sess-1");
    expect(event.pattern_matched).toMatch(/en\./);
  });

  test("scanObservationForCorrection skips non-claude-code observations", () => {
    db.run(
      "INSERT INTO source VALUES ('file-src','file:///a.md','local-file',NULL,0.0,'user',datetime('now'),NULL)"
    );
    const noisyText = "Some markdown with 'I was wrong about' embedded in a quote.";
    db.run(
      "INSERT INTO observations VALUES ('obs-file','file-src','file:///a.md',datetime('now'),datetime('now'),'h','r',?,NULL,'text/plain','test',1,'user','idem-file','tp-2026-04',NULL,NULL,NULL)",
      [Buffer.from(noisyText)]
    );
    const result = scanObservationForCorrection(db, "obs-file");
    expect(result.eventId).toBeNull();
  });

  test("scanObservationForCorrection ignores hook metadata keys (no false match)", () => {
    db.run(
      "INSERT INTO source VALUES ('claude-code:sess-2:/x','claude-code://sess-2','claude-code',NULL,0.0,'first_party',datetime('now'),NULL)"
    );
    const envelope = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-2",
      cwd: "/x",
      timestamp: "2026-04-15T10:00:00Z",
      payload: { prompt: "hello world" }, // no correction pattern
    };
    db.run(
      "INSERT INTO observations VALUES ('obs-clean','claude-code:sess-2:/x','claude-code://sess-2',datetime('now'),datetime('now'),'h','r',?,NULL,'application/json','claude-code',1,'first_party','idem-clean','tp-2026-04',NULL,NULL,NULL)",
      [Buffer.from(JSON.stringify(envelope))]
    );
    expect(scanObservationForCorrection(db, "obs-clean").eventId).toBeNull();
  });

  test("scanObservationForCorrection returns null for missing observe_id", () => {
    expect(scanObservationForCorrection(db, "does-not-exist").eventId).toBeNull();
  });

  test("scanObservationForCorrection handles invalid JSON in raw_bytes", () => {
    db.run(
      "INSERT INTO source VALUES ('claude-code:sess-3:/y','claude-code://sess-3','claude-code',NULL,0.0,'first_party',datetime('now'),NULL)"
    );
    db.run(
      "INSERT INTO observations VALUES ('obs-bad','claude-code:sess-3:/y','claude-code://sess-3',datetime('now'),datetime('now'),'h','r',?,NULL,'application/json','claude-code',1,'first_party','idem-bad','tp-2026-04',NULL,NULL,NULL)",
      [Buffer.from("not valid json {{")]
    );
    expect(scanObservationForCorrection(db, "obs-bad").eventId).toBeNull();
  });
});
