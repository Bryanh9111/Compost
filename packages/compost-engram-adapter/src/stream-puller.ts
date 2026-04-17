import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { MCPCallResult } from "./writer";
import { STREAM_FOR_COMPOST_DEFAULT_LIMIT } from "./constants";

// 9-key contract shape per Engram ARCHITECTURE.md §7.1.
// Source of truth: packages/compost-engram-adapter/test/*.test.ts fixtures
// must stay aligned with Engram's `_memory_to_compost_dict` serializer
// (Engram commit 0ee0580). Drift detector runs via zod in contract tests.
export const engramStreamEntrySchema = z.object({
  memory_id: z.string().min(1),
  kind: z.string().min(1),
  content: z.string(),
  project: z.string().nullable(),
  scope: z.enum(["project", "global", "meta"]),
  created_at: z.string(),
  updated_at: z.string(),
  tags: z.array(z.string()),
  origin: z.enum(["human", "agent", "compost"]),
});

export type EngramStreamEntry = z.infer<typeof engramStreamEntrySchema>;

export interface StreamForCompostArgs {
  since?: string | null;
  kinds?: string[];
  project?: string | null;
  include_compost?: boolean;
  limit?: number;
}

export interface EngramStreamClient {
  streamForCompost(
    args: StreamForCompostArgs
  ): Promise<MCPCallResult<EngramStreamEntry[]>>;
}

export interface StreamCursor {
  since: string | null;
  last_memory_id: string | null;
}

export interface PullBatchResult {
  entries: EngramStreamEntry[];
  cursor: StreamCursor;
  reached_end: boolean;
}

export interface PullAllStats {
  batches: number;
  total_entries: number;
  last_cursor: StreamCursor;
  errors: string[];
}

export const DEFAULT_CURSOR_PATH = join(
  homedir(),
  ".compost",
  "engram-cursor.json"
);

const EMPTY_CURSOR: StreamCursor = {
  since: null,
  last_memory_id: null,
};

/**
 * StreamPuller polls Engram's `stream_for_compost` MCP tool in batches,
 * persisting a monotonic cursor on `updated_at`. Contract invariants:
 *
 * - `updated_at === created_at` on Engram side (append-only, ARCHITECTURE §5).
 * - `origin=compost` excluded by default (feedback-loop prevention §7.1).
 * - Limit bounded at 1000 per batch; caller polls in rounds.
 *
 * Cursor is durable on disk so a restart resumes from the last seen
 * `updated_at` — reprocessing stops are bounded by the single-entry
 * granularity of the `updated_at` comparison (Engram uses strict `>`).
 */
export class StreamPuller {
  private readonly client: EngramStreamClient;
  private readonly cursorPath: string;
  private readonly defaultKinds?: string[];
  private readonly defaultProject?: string | null;

  constructor(
    client: EngramStreamClient,
    opts: {
      cursorPath?: string;
      kinds?: string[];
      project?: string | null;
    } = {}
  ) {
    this.client = client;
    this.cursorPath = opts.cursorPath ?? DEFAULT_CURSOR_PATH;
    if (opts.kinds !== undefined) this.defaultKinds = opts.kinds;
    if (opts.project !== undefined) this.defaultProject = opts.project;
  }

  loadCursor(): StreamCursor {
    if (!existsSync(this.cursorPath)) return { ...EMPTY_CURSOR };
    try {
      const raw = readFileSync(this.cursorPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StreamCursor>;
      return {
        since: parsed.since ?? null,
        last_memory_id: parsed.last_memory_id ?? null,
      };
    } catch {
      return { ...EMPTY_CURSOR };
    }
  }

  saveCursor(cursor: StreamCursor): void {
    mkdirSync(dirname(this.cursorPath), { recursive: true });
    writeFileSync(this.cursorPath, JSON.stringify(cursor, null, 2), "utf-8");
  }

  /**
   * Pull one batch. Advances the returned cursor to the max `updated_at`
   * observed; does NOT persist — caller persists via saveCursor() after
   * downstream ingest succeeds, so a mid-batch failure retries safely.
   */
  async pullBatch(opts: {
    limit?: number;
    cursor?: StreamCursor;
  } = {}): Promise<PullBatchResult> {
    const cursor = opts.cursor ?? this.loadCursor();
    const limit = opts.limit ?? STREAM_FOR_COMPOST_DEFAULT_LIMIT;

    const args: StreamForCompostArgs = {
      since: cursor.since,
      limit,
      include_compost: false,
    };
    if (this.defaultKinds !== undefined) args.kinds = this.defaultKinds;
    if (this.defaultProject !== undefined) args.project = this.defaultProject;

    const result = await this.client.streamForCompost(args);
    if (!result.ok || !result.data) {
      throw new Error(
        `stream_for_compost failed: ${result.error ?? "no data returned"}`
      );
    }

    const entries = this.dedupeAndValidate(result.data, cursor);
    const nextCursor = this.advanceCursor(cursor, entries);
    const reachedEnd = entries.length < limit;
    return { entries, cursor: nextCursor, reached_end: reachedEnd };
  }

  /**
   * Pull until an empty batch is returned. Persists cursor after each
   * successful batch. `onBatch` callback lets the caller ingest in-place
   * before the cursor advances on disk — critical for crash-safety.
   */
  async pullAll(
    onBatch?: (entries: EngramStreamEntry[]) => Promise<void> | void
  ): Promise<PullAllStats> {
    let cursor = this.loadCursor();
    let batches = 0;
    let total = 0;
    const errors: string[] = [];

    while (true) {
      let batch: PullBatchResult;
      try {
        batch = await this.pullBatch({ cursor });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        break;
      }

      if (onBatch && batch.entries.length > 0) {
        try {
          await onBatch(batch.entries);
        } catch (e) {
          errors.push(
            `onBatch failed: ${e instanceof Error ? e.message : String(e)}`
          );
          break;
        }
      }

      batches++;
      total += batch.entries.length;
      cursor = batch.cursor;
      this.saveCursor(cursor);

      // Only break on empty batch — a short-but-non-empty batch might just
      // mean "all remaining entries at this cursor" while a future poll
      // could surface more if Engram received new writes. Trust the loop.
      if (batch.entries.length === 0) break;
    }

    return { batches, total_entries: total, last_cursor: cursor, errors };
  }

  private dedupeAndValidate(
    raw: EngramStreamEntry[],
    cursor: StreamCursor
  ): EngramStreamEntry[] {
    const seen = new Set<string>();
    if (cursor.last_memory_id) seen.add(cursor.last_memory_id);
    const out: EngramStreamEntry[] = [];
    for (const candidate of raw) {
      const entry = engramStreamEntrySchema.parse(candidate);
      if (seen.has(entry.memory_id)) continue;
      seen.add(entry.memory_id);
      out.push(entry);
    }
    return out;
  }

  private advanceCursor(
    prior: StreamCursor,
    entries: EngramStreamEntry[]
  ): StreamCursor {
    if (entries.length === 0) return prior;
    let maxUpdatedAt = prior.since ?? "";
    let lastMemoryId = prior.last_memory_id;
    for (const e of entries) {
      if (e.updated_at > maxUpdatedAt) {
        maxUpdatedAt = e.updated_at;
        lastMemoryId = e.memory_id;
      }
    }
    return {
      since: maxUpdatedAt || null,
      last_memory_id: lastMemoryId,
    };
  }
}
