import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { DEFAULT_PENDING_DB_PATH } from "../../../compost-engram-adapter/src/constants";
import { PendingWritesQueue } from "../../../compost-engram-adapter/src/pending-writes";
import { reconcileEngramQueue } from "../../../compost-engram-adapter/src/reconcile";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_LLM_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_OLLAMA_SERVICE_TIMEOUT_MS = 3_000;

interface ProbeError {
  name: string;
  message: string;
}

export function parsePositiveInteger(
  raw: string | number | undefined,
  fallback: number
): number {
  if (raw === undefined) return fallback;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isFatalLlmProbeError(
  error: ProbeError,
  strict: boolean
): boolean {
  return strict || error.name !== "AbortError";
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function errorInfo(err: unknown): ProbeError {
  return {
    name: err instanceof Error ? err.name : "unknown",
    message: err instanceof Error ? err.message : String(err),
  };
}

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnostic and maintenance operations")
    .option("--reconcile", "Count observations vs facts and report delta")
    .option(
      "--measure-hook",
      "Measure cold-start latency of `compost hook session-start` (n=100)"
    )
    .option(
      "--drain-retry",
      "Release quarantined outbox rows back into the drain queue"
    )
    .option("--rebuild <layer>", "Rebuild a derivation layer (e.g. L1)")
    .option("--policy <name>", "Policy name for --rebuild")
    .option(
      "--check-llm",
      "Ping Ollama with a short probe and report latency / model / setup hint"
    )
    .option(
      "--ollama-url <url>",
      "Ollama base URL for --check-llm",
      process.env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL
    )
    .option(
      "--llm-model <model>",
      "Model for --check-llm generation probe (default: COMPOST_LLM_MODEL or Compost default)"
    )
    .option(
      "--llm-timeout-ms <n>",
      "Generation probe timeout for --check-llm",
      (v) => parsePositiveInteger(v, DEFAULT_LLM_PROBE_TIMEOUT_MS),
      parsePositiveInteger(
        process.env["COMPOST_DOCTOR_LLM_TIMEOUT_MS"],
        DEFAULT_LLM_PROBE_TIMEOUT_MS
      )
    )
    .option(
      "--strict-llm",
      "For --check-llm, exit non-zero on generation timeout instead of reporting a warning"
    )
    .option(
      "--check-pii",
      "Scan observe_outbox.payload for PII patterns (CC / tokens / keys); report only, no mutation"
    )
    .option(
      "--check-integrity",
      "Audit schema integrity: orphan observations, dangling fact_links, stale wiki_pages, unknown transform_policy"
    )
    .option(
      "--reconcile-engram",
      "Local scan over ~/.compost/pending-engram-writes.db — surfaces pair fragments (R5 blind-write mitigation), stuck rows, and expired-but-not-pruned entries. Exit code 1 if anything flagged"
    )
    .option(
      "--queue-path <path>",
      "Pending writes SQLite path (for --reconcile-engram)",
      DEFAULT_PENDING_DB_PATH
    )
    .option(
      "--stuck-threshold-days <n>",
      "Age (days) above which pending rows are flagged stuck (for --reconcile-engram)",
      (v) => Number.parseInt(v, 10),
      7
    )
    .action(async (opts) => {
      if (opts.reconcileEngram) {
        const queue = new PendingWritesQueue(opts.queuePath);
        try {
          const report = reconcileEngramQueue(queue, {
            stuckThresholdDays: opts.stuckThresholdDays,
          });
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          if (!report.ok) process.exitCode = 1;
        } finally {
          queue.close();
        }
        return;
      }

      if (opts.reconcile) {
        const db = openDb();
        try {
          const obsRow = db
            .query("SELECT COUNT(*) AS c FROM observations")
            .get() as { c: number };
          const factRow = db
            .query("SELECT COUNT(*) AS c FROM facts")
            .get() as { c: number };
          const observations = obsRow.c;
          const facts = factRow.c;
          process.stdout.write(
            JSON.stringify({ observations, facts, delta: observations - facts }) +
              "\n"
          );
        } finally {
          db.close();
        }
        return;
      }

      if (opts.measureHook) {
        // Spec §3b.5: Hook cold-start measurement protocol
        const SHIM_PATH = join(
          import.meta.dir,
          "../../../compost-hook-shim/src/index.ts"
        );
        const dataDir =
          process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;

        // Step 1: Ensure shim exists
        if (!existsSync(SHIM_PATH)) {
          process.stderr.write(
            `error: hook shim not found at ${SHIM_PATH}\n`
          );
          process.exit(2);
        }

        // Ensure data dir + migrations for measurement
        if (!existsSync(dataDir))
          mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        const setupDb = new Database(join(dataDir, "ledger.db"), {
          create: true,
        });
        setupDb.exec("PRAGMA journal_mode=WAL");
        setupDb.exec("PRAGMA foreign_keys=ON");
        applyMigrations(setupDb);
        const { upsertPolicies } = await import(
          "../../../compost-core/src/policies/registry"
        );
        upsertPolicies(setupDb);
        setupDb.close();

        // Step 2: Warm filesystem cache
        for (let i = 0; i < 3; i++) {
          Bun.spawnSync(["cat", SHIM_PATH], { stdout: "pipe" });
        }

        const shimEnv = { ...process.env, COMPOST_DATA_DIR: dataDir };

        function makeEnvelope(id: string) {
          return JSON.stringify({
            hook_event_name: "SessionStart",
            session_id: id,
            cwd: "/tmp/measure",
            timestamp: new Date().toISOString(),
            payload: {},
          });
        }

        // Step 3: 5 warmup samples (discarded)
        for (let i = 0; i < 5; i++) {
          const p = Bun.spawn(
            ["bun", SHIM_PATH, "session-start"],
            {
              stdin: new Blob([makeEnvelope(`warmup-${i}`)]),
              stdout: "pipe",
              stderr: "pipe",
              env: shimEnv,
            }
          );
          await p.exited;
        }

        // Step 4: 100 measurement samples
        const N = 100;
        const latencies: number[] = [];
        for (let i = 0; i < N; i++) {
          const envelope = makeEnvelope(`measure-${Date.now()}-${i}`);
          const t0 = performance.now();
          const p = Bun.spawn(
            ["bun", SHIM_PATH, "session-start"],
            {
              stdin: new Blob([envelope]),
              stdout: "pipe",
              stderr: "pipe",
              env: shimEnv,
            }
          );
          await p.exited;
          latencies.push(performance.now() - t0);
          // 50ms sleep between samples (let SQLite flush WAL)
          await Bun.sleep(50);
        }

        // Step 5: Trim top 2% + bottom 2%, compute percentiles
        const sorted = latencies.slice().sort((a, b) => a - b);
        const trimCount = Math.floor(N * 0.02);
        const trimmed = sorted.slice(trimCount, sorted.length - trimCount);

        const p50 = +percentile(trimmed, 50).toFixed(1);
        const p90 = +percentile(trimmed, 90).toFixed(1);
        const p95 = +percentile(trimmed, 95).toFixed(1);
        const p99 = +percentile(trimmed, 99).toFixed(1);
        const max = +trimmed[trimmed.length - 1]!.toFixed(1);

        const stats = {
          n: N,
          trimmed_n: trimmed.length,
          p50,
          p90,
          p95,
          p99,
          max,
          unit: "ms",
          ship_gate: p95 <= 30 ? "PASS" : "FAIL",
        };

        process.stdout.write(JSON.stringify(stats, null, 2) + "\n");

        // Step 6: Persist results
        const logsDir = join(dataDir, "logs");
        if (!existsSync(logsDir))
          mkdirSync(logsDir, { recursive: true, mode: 0o700 });
        const today = new Date().toISOString().slice(0, 10);
        const logPath = join(
          logsDir,
          `hook-measurement-${today}.jsonl`
        );
        const { appendFileSync } = await import("fs");
        appendFileSync(
          logPath,
          JSON.stringify({
            ...stats,
            timestamp: new Date().toISOString(),
            raw_latencies: latencies,
          }) + "\n"
        );

        // Step 7: Exit code
        process.exit(p95 <= 30 ? 0 : 1);
      }

      if (opts.drainRetry) {
        const db = openDb();
        try {
          const result = db.run(
            "UPDATE observe_outbox SET drain_quarantined_at = NULL WHERE drain_quarantined_at IS NOT NULL"
          );
          process.stdout.write(
            JSON.stringify({ released: result.changes }) + "\n"
          );
        } finally {
          db.close();
        }
        return;
      }

      if (opts.rebuild) {
        const layer = opts.rebuild;
        if (layer !== "L1") {
          process.stderr.write(`error: only --rebuild L1 is supported\n`);
          process.exit(1);
        }

        const db = openDb();
        const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
        try {
          const { OllamaEmbeddingService } = await import(
            "../../../compost-core/src/embedding/ollama"
          );
          const { VectorStore } = await import(
            "../../../compost-core/src/storage/lancedb"
          );

          const embSvc = new OllamaEmbeddingService();
          const lanceDir = join(dataDir, "lancedb");
          const tempLanceDir = join(dataDir, "lancedb-rebuild-tmp");

          // Build new index in temp location (atomic rebuild)
          const tempStore = new VectorStore(tempLanceDir, embSvc);
          await tempStore.connect();

          // Read all chunks from SQLite (source of truth)
          const chunks = db
            .query(
              `SELECT c.chunk_id, c.observe_id, c.text_content,
                      f.fact_id
               FROM chunks c
               LEFT JOIN facts f ON f.observe_id = c.observe_id
               ORDER BY c.created_at`
            )
            .all() as Array<{
              chunk_id: string;
              observe_id: string;
              text_content: string;
              fact_id: string | null;
            }>;

          if (chunks.length === 0) {
            process.stdout.write(
              JSON.stringify({ ok: true, rebuilt: 0, message: "no chunks to rebuild" }) + "\n"
            );
            await tempStore.close();
            return;
          }

          // Batch embed all chunk texts
          const BATCH = 64;
          let embedded = 0;
          for (let i = 0; i < chunks.length; i += BATCH) {
            const batch = chunks.slice(i, i + BATCH);
            const texts = batch.map((c) => c.text_content);
            const vectors = await embSvc.embed(texts);

            const chunkVectors = batch.map((c, j) => ({
              chunk_id: c.chunk_id,
              fact_id: c.fact_id ?? `orphan:${c.observe_id}`,
              observe_id: c.observe_id,
              vector: vectors[j]!,
            }));

            await tempStore.add(chunkVectors);
            embedded += chunkVectors.length;
          }

          await tempStore.close();

          // Atomic swap: remove old, rename temp to live
          const { rmSync: rm, renameSync } = await import("fs");
          try { rm(lanceDir, { recursive: true, force: true }); } catch {}
          renameSync(tempLanceDir, lanceDir);

          // Update chunks.embedded_at
          db.run(
            "UPDATE chunks SET embedded_at = datetime('now') WHERE embedded_at IS NULL"
          );

          process.stdout.write(
            JSON.stringify({ ok: true, rebuilt: embedded }) + "\n"
          );
        } finally {
          db.close();
        }
        return;
      }

      if (opts.checkLlm) {
        // Keep the service liveness check separate from the model-generation
        // probe. A cold 30B-class local model often misses a 3s keyboard
        // window; that is useful operator signal, but not the same as
        // "Ollama is down".
        const { OllamaLLMService } = await import(
          "../../../compost-core/src/llm/ollama"
        );
        const baseUrl = opts.ollamaUrl;
        const serviceT0 = performance.now();
        let modelNames: string[] = [];
        try {
          const body = (await fetchJsonWithTimeout(
            `${baseUrl.replace(/\/$/, "")}/api/tags`,
            DEFAULT_OLLAMA_SERVICE_TIMEOUT_MS
          )) as { models?: Array<{ name?: string; model?: string }> };
          modelNames = (body.models ?? [])
            .map((m) => m.name ?? m.model)
            .filter((m): m is string => Boolean(m));
        } catch (err) {
          const latencyMs = +(performance.now() - serviceT0).toFixed(1);
          process.stdout.write(
            JSON.stringify(
              {
                ok: false,
                ollama: {
                  ok: false,
                  base_url: baseUrl,
                  latency_ms: latencyMs,
                  error: errorInfo(err),
                },
                hint:
                  "Ollama did not answer /api/tags. Start it with `ollama serve` " +
                  "or check OLLAMA_BASE_URL / --ollama-url.",
              },
              null,
              2
            ) + "\n"
          );
          process.exit(1);
        }

        const serviceLatencyMs = +(performance.now() - serviceT0).toFixed(1);
        const configuredModel = opts.llmModel ?? process.env["COMPOST_LLM_MODEL"];
        const llm = new OllamaLLMService({
          baseUrl,
          ...(configuredModel ? { model: configuredModel } : {}),
        });
        const timeoutMs = opts.llmTimeoutMs;
        const t0 = performance.now();
        try {
          const answer = await llm.generate("ping", {
            maxTokens: 8,
            timeoutMs,
          });
          const latencyMs = +(performance.now() - t0).toFixed(1);
          process.stdout.write(
            JSON.stringify(
              {
                ok: true,
                ollama: {
                  ok: true,
                  base_url: baseUrl,
                  latency_ms: serviceLatencyMs,
                  models: modelNames,
                },
                generation: {
                  ok: true,
                  model: llm.model,
                  timeout_ms: timeoutMs,
                  latency_ms: latencyMs,
                  sample_response: answer.slice(0, 80),
                },
              },
              null,
              2
            ) + "\n"
          );
          return;
        } catch (err) {
          const latencyMs = +(performance.now() - t0).toFixed(1);
          const error = errorInfo(err);
          const fatal = isFatalLlmProbeError(error, Boolean(opts.strictLlm));
          process.stdout.write(
            JSON.stringify(
              {
                ok: !fatal,
                ollama: {
                  ok: true,
                  base_url: baseUrl,
                  latency_ms: serviceLatencyMs,
                  models: modelNames,
                },
                generation: {
                  ok: false,
                  model: llm.model,
                  timeout_ms: timeoutMs,
                  latency_ms: latencyMs,
                  error,
                  severity: fatal ? "error" : "warn",
                  strict: Boolean(opts.strictLlm),
                },
                hint:
                  fatal
                    ? "Ollama is reachable, but the generation probe failed. Check the model name, increase --llm-timeout-ms, or run without --strict-llm for a liveness-only check."
                    : "Ollama is reachable, but the generation probe did not finish inside the quick timeout. Large or cold local models can do this. Use --llm-timeout-ms for a deeper probe, --llm-model for a smaller model, or --strict-llm when automation should fail on this.",
              },
              null,
              2
            ) + "\n"
          );
          if (fatal) process.exit(1);
          return;
        }
      }

      if (opts.checkPii) {
        // Phase 4 P1 / fork-ready open-source gate: surface-only scan for
        // PII patterns in observe_outbox.payload. No mutation; findings are
        // reported as JSON so the user can decide remediation (re-ingest
        // with COMPOST_PII_STRICT=true, quarantine rows, or purge).
        const { scrub } = await import(
          "../../../compost-hook-shim/src/pii"
        );
        const db = openDb();
        try {
          const rows = db
            .query(
              "SELECT seq, source_id, payload FROM observe_outbox ORDER BY seq"
            )
            .all() as Array<{ seq: number; source_id: string; payload: string }>;

          let rowsWithPii = 0;
          let totalRedactions = 0;
          const sampleSources: Array<{ seq: number; source_id: string; redactions: number }> = [];

          for (const row of rows) {
            const { redactions } = scrub(row.payload);
            if (redactions > 0) {
              rowsWithPii++;
              totalRedactions += redactions;
              if (sampleSources.length < 5) {
                sampleSources.push({
                  seq: row.seq,
                  source_id: row.source_id,
                  redactions,
                });
              }
            }
          }

          process.stdout.write(
            JSON.stringify(
              {
                rows_scanned: rows.length,
                rows_with_pii: rowsWithPii,
                total_redactions: totalRedactions,
                sample_sources: sampleSources,
                hint:
                  rowsWithPii > 0
                    ? "PII found in existing rows. hook-shim scrubs new observations automatically. To scrub existing rows, manually purge or re-ingest with COMPOST_PII_STRICT=true."
                    : "No PII patterns detected in observe_outbox.",
              },
              null,
              2
            ) + "\n"
          );
          return;
        } finally {
          db.close();
        }
      }

      if (opts.checkIntegrity) {
        // Phase 4 P1 / debate 017: one-shot schema integrity audit. Reports
        // findings as JSON (no fixes applied). Categories:
        //   orphan_observations: observations with no derivation_run (extraction never happened)
        //   dangling_fact_links: fact_links whose src/dst fact no longer exists
        //   stale_wiki_pages: wiki_pages marked stale_at but never resynthesized
        //   unknown_transform_policies: observations/outbox rows referencing policy ids not in policies table
        const db = openDb();
        try {
          const orphanObs = db
            .query(
              `SELECT COUNT(*) AS c FROM observations o
               WHERE NOT EXISTS (
                 SELECT 1 FROM derivation_run dr WHERE dr.observe_id = o.observe_id
               )`
            )
            .get() as { c: number };

          const danglingLinks = db
            .query(
              `SELECT COUNT(*) AS c FROM fact_links fl
               WHERE NOT EXISTS (SELECT 1 FROM facts f WHERE f.fact_id = fl.from_fact_id)
                  OR NOT EXISTS (SELECT 1 FROM facts f WHERE f.fact_id = fl.to_fact_id)`
            )
            .get() as { c: number };

          const staleWikiCount = db
            .query(
              `SELECT COUNT(*) AS c FROM wiki_pages
               WHERE stale_at IS NOT NULL
                 AND (last_synthesis_at IS NULL OR last_synthesis_at < stale_at)`
            )
            .get() as { c: number };

          const unknownPolicyOutbox = db
            .query(
              `SELECT COUNT(*) AS c FROM observe_outbox o
               WHERE NOT EXISTS (SELECT 1 FROM policies p WHERE p.policy_id = o.transform_policy)`
            )
            .get() as { c: number };

          const unknownPolicyObs = db
            .query(
              `SELECT COUNT(*) AS c FROM observations o
               WHERE NOT EXISTS (SELECT 1 FROM policies p WHERE p.policy_id = o.transform_policy)`
            )
            .get() as { c: number };

          const totalIssues =
            orphanObs.c +
            danglingLinks.c +
            staleWikiCount.c +
            unknownPolicyOutbox.c +
            unknownPolicyObs.c;

          process.stdout.write(
            JSON.stringify(
              {
                orphan_observations: orphanObs.c,
                dangling_fact_links: danglingLinks.c,
                stale_wiki_pages: staleWikiCount.c,
                unknown_transform_policies: {
                  in_observe_outbox: unknownPolicyOutbox.c,
                  in_observations: unknownPolicyObs.c,
                },
                total_issues: totalIssues,
                hint:
                  totalIssues > 0
                    ? "Integrity issues detected. Review via `docs/dogfood-notes.md` workflow; no automatic fix applied."
                    : "Schema integrity checks passed.",
              },
              null,
              2
            ) + "\n"
          );
          return;
        } finally {
          db.close();
        }
      }

      process.stderr.write(
        "doctor: specify --reconcile, --measure-hook, --drain-retry, --rebuild, --check-llm, --check-pii, --check-integrity, or --reconcile-engram\n"
      );
      process.exit(1);
    });
}
