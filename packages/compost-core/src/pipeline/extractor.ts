import { existsSync } from "fs";
import { resolve } from "path";
import type { ExtractionOutput } from "./persist-extraction";

/** Input contract of `python -m compost_ingest extract` (schema.py). */
export interface ExtractionInput {
  observe_id: string;
  source_uri: string;
  mime_type: string;
  content_ref: "inline";
  content: string;
  transform_policy: string;
  /** Chunks only, no Ollama calls (manifest backfill). */
  skip_llm_facts?: boolean;
}

export interface ExtractOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Runs one extraction. Tests inject a fake instead of spawning Python. */
export type ExtractFn = (input: ExtractionInput, opts: ExtractOptions) => Promise<ExtractionOutput>;

const DEFAULT_TIMEOUT_SEC = 600;

/**
 * Policies are immutable and their timeoutSec (120/180) predates LLM fact
 * extraction, which can run 20 chunks x 30s. The floor comes from
 * COMPOST_EXTRACT_TIMEOUT_SEC (default 600s); the policy only ever raises it.
 */
export function extractionTimeoutMs(policyTimeoutSec: number): number {
  const env = Number(process.env.COMPOST_EXTRACT_TIMEOUT_SEC);
  const floorSec = Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_SEC;
  return Math.max(policyTimeoutSec, floorSec) * 1000;
}

export function extractorCommand(): { cmd: string[]; cwd: string } {
  const ingestPkgDir = resolve(import.meta.dir, "../../..", "compost-ingest");
  const venvPython = resolve(ingestPkgDir, ".venv/bin/python");
  const cmd = existsSync(venvPython)
    ? [venvPython, "-m", "compost_ingest", "extract"]
    : ["uv", "run", "--project", ingestPkgDir, "python", "-m", "compost_ingest", "extract"];
  return { cmd, cwd: ingestPkgDir };
}

/**
 * Spawn the Python extractor with a hard timeout. The abort signal (lease
 * lost) kills the subprocess so a stolen row is never persisted twice.
 */
export const runExtractor: ExtractFn = async (input, opts) => {
  const { cmd, cwd } = extractorCommand();
  const proc = Bun.spawn(cmd, {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    timeout: opts.timeoutMs,
    killSignal: "SIGKILL",
  });
  const onAbort = () => proc.kill("SIGKILL");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (opts.signal?.aborted) {
      throw new Error(`extraction aborted: ${String(opts.signal.reason ?? "cancelled")}`);
    }
    if (proc.signalCode === "SIGKILL") {
      throw new Error(`extraction timed out after ${opts.timeoutMs}ms`);
    }
    if (exitCode !== 0) {
      throw new Error(`extraction failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }
    try {
      return JSON.parse(stdout) as ExtractionOutput;
    } catch {
      throw new Error(`extraction output is not valid JSON: ${stdout.slice(0, 200)}`);
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
};
