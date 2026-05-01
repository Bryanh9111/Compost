import { homedir } from "os";
import { dirname, join } from "path";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

const DEFAULT_LOCK_DIR = join(homedir(), ".cache", "zylo-ollama", "ollama.lock");
const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_WAIT_MS = 4 * 60 * 60 * 1000;
const RETRY_MS = 500;

interface LockMetadata {
  pid: number;
  label: string;
  token: string;
  acquiredAt: string;
}

interface ErrnoLike {
  code?: string;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isStale(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const raw = await readFile(join(lockDir, "owner.json"), "utf8");
    const metadata = JSON.parse(raw) as Partial<LockMetadata>;
    const acquiredAt = Date.parse(String(metadata.acquiredAt ?? ""));
    return Number.isFinite(acquiredAt) && Date.now() - acquiredAt > staleMs;
  } catch {
    return false;
  }
}

async function acquire(lockDir: string, label: string): Promise<() => Promise<void>> {
  const staleMs = numberFromEnv("ZYLO_OLLAMA_LOCK_STALE_MS", DEFAULT_STALE_MS);
  const waitMs = numberFromEnv("ZYLO_OLLAMA_LOCK_WAIT_MS", DEFAULT_WAIT_MS);
  const deadline = Date.now() + waitMs;
  const token = randomUUID();

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      await writeFile(
        join(lockDir, "owner.json"),
        JSON.stringify(
          { pid: process.pid, label, token, acquiredAt: new Date().toISOString() },
          null,
          2
        ),
        "utf8"
      );
      return async () => {
        try {
          const raw = await readFile(join(lockDir, "owner.json"), "utf8");
          const metadata = JSON.parse(raw) as Partial<LockMetadata>;
          if (metadata.token !== token) return;
        } catch {
          return;
        }
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      if ((err as ErrnoLike).code !== "EEXIST") {
        throw err;
      }
      if (await isStale(lockDir, staleMs)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Ollama lock: ${lockDir}`);
      }
      await sleep(RETRY_MS);
    }
  }
}

export async function withOllamaLock<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockDir = process.env.ZYLO_OLLAMA_LOCK_DIR ?? DEFAULT_LOCK_DIR;
  const release = await acquire(lockDir, label);
  try {
    return await fn();
  } finally {
    await release();
  }
}
