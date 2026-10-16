import { copyFileSync, existsSync, renameSync, rmSync, statSync, truncateSync } from "fs";

export interface RotateLogOptions {
  /** Rotate once the live file exceeds this size. Default 20 MiB. */
  maxBytes?: number;
  /** Generations to keep (`<path>.1` .. `<path>.N`). Default 5. */
  keep?: number;
}

export interface RotateLogResult {
  rotated: boolean;
  sizeBytes: number;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_KEEP = 5;

/**
 * Copy-then-truncate rotation for a log that another process (launchd)
 * holds open in append mode: the writer keeps its descriptor, the copy
 * becomes `<path>.1`, older generations shift up and the oldest is dropped.
 * Lines written between the copy and the truncate are lost; the daemon
 * calls this once a day from the backup tick, so that window is tiny.
 */
export function rotateLog(path: string, opts: RotateLogOptions = {}): RotateLogResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = Math.max(1, opts.keep ?? DEFAULT_KEEP);
  if (!existsSync(path)) return { rotated: false, sizeBytes: 0 };
  const sizeBytes = statSync(path).size;
  if (sizeBytes <= maxBytes) return { rotated: false, sizeBytes };

  rmSync(`${path}.${keep}`, { force: true });
  for (let generation = keep - 1; generation >= 1; generation--) {
    const from = `${path}.${generation}`;
    if (existsSync(from)) renameSync(from, `${path}.${generation + 1}`);
  }
  copyFileSync(path, `${path}.1`);
  truncateSync(path, 0);
  return { rotated: true, sizeBytes };
}
