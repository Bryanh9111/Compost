import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  startBackupScheduler,
  startDrainLoop,
  startFreshnessLoop,
  startGraphHealthScheduler,
  startIngestWorker,
  startReasoningScheduler,
  startReflectScheduler,
  type Scheduler,
} from "../src/scheduler";
import { collectSchedulerHealth } from "../src/main";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import type { EmbeddingService } from "../../compost-core/src/embedding/types";
import type { LLMService } from "../../compost-core/src/llm/types";
import type { VectorStore } from "../../compost-core/src/storage/lancedb";

type SleepResolver = () => void;

const originalSleep = Bun.sleep;
let sleepResolvers: SleepResolver[] = [];

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  const result = applyMigrations(db);
  if (result.errors.length > 0) {
    throw new Error(`Migration failed: ${result.errors[0]?.error ?? "unknown"}`);
  }
  upsertPolicies(db);
  return db;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "compost-scheduler-health-"));
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

async function waitFor(assertion: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await waitFrame();
  }
  throw new Error(message);
}

async function releaseNextSleep(): Promise<void> {
  await waitFor(() => sleepResolvers.length > 0, "scheduler did not reach sleep");
  const resolve = sleepResolvers.shift();
  resolve?.();
}

async function releaseAllSleeps(): Promise<void> {
  for (const resolve of sleepResolvers.splice(0)) resolve();
  await waitFrame();
}

const embeddingService: EmbeddingService = {
  model: "test",
  dim: 2,
  async embed(texts: string[]) {
    return texts.map(() => new Float32Array([0, 0]));
  },
};

const vectorStore = {
  async add() {},
} as unknown as VectorStore;

const llm: LLMService = {
  model: "test",
  async generate() {
    return "{}";
  },
};

const throwingDb = {
  query() {
    throw new Error("forced query failure");
  },
  transaction() {
    throw new Error("forced transaction failure");
  },
  exec() {
    throw new Error("forced exec failure");
  },
  run() {
    throw new Error("forced run failure");
  },
} as unknown as Database;

interface SchedulerSpec {
  name: string;
  startHealthy: (ctx: { db: Database; dir: string }) => Scheduler;
  startThrowing: (ctx: { dir: string }) => Scheduler;
  releaseBeforeTick: boolean;
}

const specs: SchedulerSpec[] = [
  {
    name: "drain",
    startHealthy: ({ db }) => startDrainLoop(db),
    startThrowing: () => startDrainLoop(throwingDb),
    releaseBeforeTick: false,
  },
  {
    name: "reflect",
    startHealthy: ({ db }) => startReflectScheduler(db, { intervalMs: 1 }),
    startThrowing: () => startReflectScheduler(throwingDb, { intervalMs: 1 }),
    releaseBeforeTick: true,
  },
  {
    name: "freshness",
    startHealthy: ({ db, dir }) => startFreshnessLoop(db, dir),
    startThrowing: ({ dir }) => startFreshnessLoop(throwingDb, dir),
    releaseBeforeTick: true,
  },
  {
    name: "ingest",
    startHealthy: ({ db, dir }) =>
      startIngestWorker(db, { embeddingService, vectorStore, dataDir: dir }),
    startThrowing: ({ dir }) =>
      startIngestWorker(throwingDb, { embeddingService, vectorStore, dataDir: dir }),
    releaseBeforeTick: false,
  },
  {
    name: "backup",
    startHealthy: ({ db, dir }) =>
      startBackupScheduler(db, {
        ledgerPath: join(dir, "ledger.db"),
        backupDir: join(dir, "backups"),
        retentionCount: 2,
      }),
    startThrowing: ({ dir }) =>
      startBackupScheduler(throwingDb, {
        ledgerPath: join(dir, "ledger.db"),
        backupDir: join(dir, "backups"),
        retentionCount: 2,
      }),
    releaseBeforeTick: true,
  },
  {
    name: "graph-health",
    startHealthy: ({ db }) => startGraphHealthScheduler(db),
    startThrowing: () => startGraphHealthScheduler(throwingDb),
    releaseBeforeTick: true,
  },
  {
    name: "reasoning",
    startHealthy: ({ db }) => startReasoningScheduler(db, llm, undefined, 1),
    startThrowing: () => startReasoningScheduler(throwingDb, llm, undefined, 1),
    releaseBeforeTick: true,
  },
];

describe("scheduler health", () => {
  let tempDirs: string[] = [];
  let openDbs: Database[] = [];

  beforeEach(() => {
    sleepResolvers = [];
    (Bun as unknown as { sleep: typeof Bun.sleep }).sleep = (() =>
      new Promise<void>((resolve) => {
        sleepResolvers.push(resolve);
      })) as typeof Bun.sleep;
  });

  afterEach(() => {
    for (const resolve of sleepResolvers.splice(0)) resolve();
    (Bun as unknown as { sleep: typeof Bun.sleep }).sleep = originalSleep;
    for (const db of openDbs.splice(0)) db.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  for (const spec of specs) {
    test(`${spec.name}: reports running, tick, errors, and stopped`, async () => {
      const db = makeDb();
      const dir = makeTempDir();
      openDbs.push(db);
      tempDirs.push(dir);

      const scheduler = spec.startHealthy({ db, dir });
      expect(scheduler.getHealth()).toMatchObject({
        name: spec.name,
        running: true,
        error_count: 0,
      });

      if (spec.releaseBeforeTick) await releaseNextSleep();
      await waitFor(
        () => scheduler.getHealth().last_tick_at !== null,
        `${spec.name} did not record a successful tick`
      );

      scheduler.stop();
      await releaseAllSleeps();
      expect(scheduler.getHealth().running).toBe(false);

      const errDir = makeTempDir();
      tempDirs.push(errDir);
      const errorScheduler = spec.startThrowing({ dir: errDir });
      if (spec.releaseBeforeTick) await releaseNextSleep();
      await waitFor(
        () => errorScheduler.getHealth().error_count > 0,
        `${spec.name} did not record a forced error`
      );
      errorScheduler.stop();
      expect(errorScheduler.getHealth().running).toBe(false);
    });
  }

  test("collector degrades one throwing scheduler without failing status", () => {
    const health = collectSchedulerHealth([
      {
        name: "ok",
        scheduler: {
          stop() {},
          getHealth() {
            return {
              name: "ok",
              last_tick_at: "2026-04-27T13:30:00.000Z",
              error_count: 0,
              running: true,
            };
          },
        },
      },
      {
        name: "broken",
        scheduler: {
          stop() {},
          getHealth() {
            throw new Error("forced health failure");
          },
        },
      },
    ]);

    expect(health).toEqual([
      {
        name: "ok",
        last_tick_at: "2026-04-27T13:30:00.000Z",
        error_count: 0,
        running: true,
      },
      {
        name: "broken",
        last_tick_at: null,
        error_count: 1,
        running: false,
      },
    ]);
  });
});
