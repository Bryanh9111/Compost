import { z } from "zod";
import { PendingWritesQueue } from "./pending-writes";
import {
  type ChunkedInsight,
  type SourceTrace,
  splitInsight,
  type SplitOptions,
} from "./splitter";
import { DEFAULT_EXPIRES_AT_DAYS } from "./constants";

// R3 mitigation — zod schema for source_trace catches field-name drift at
// the writer boundary before Engram silently accepts a malformed payload.
// Keep the shape aligned with ChunkedInsight's SourceTrace type.
export const sourceTraceSchema = z.object({
  compost_fact_ids: z.array(z.string()).min(1),
  root_insight_id: z.string().uuid(),
  chunk_index: z.number().int().nonnegative(),
  total_chunks: z.number().int().positive(),
  split_strategy: z.enum(["none", "paragraph", "sentence", "hard-cut"]),
  synthesized_at: z.string(),
  compost_wiki_path: z.string().optional(),
  derivation_run_id: z.string().optional(),
});

export function validateSourceTrace(st: unknown): SourceTrace {
  return sourceTraceSchema.parse(st) as SourceTrace;
}

export interface RememberArgs {
  origin: "compost";
  kind: "insight";
  content: string;
  project: string | null;
  scope: "project" | "global" | "meta";
  source_trace: SourceTrace;
  expires_at: string;
  confidence?: number;
  tags?: string[];
}

export interface MCPCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface EngramMcpClient {
  remember(args: RememberArgs): Promise<MCPCallResult<{ id: string }>>;
  invalidate(args: {
    fact_ids: string[];
  }): Promise<
    MCPCallResult<{ invalidated_memory_ids: string[]; count: number }>
  >;
}

export interface WriteInsightOptions extends SplitOptions {
  scope?: "project" | "global" | "meta";
  confidence?: number;
  tags?: string[];
  expiresAt?: string;
}

export interface ChunkWriteOutcome {
  chunk_index: number;
  total_chunks: number;
  status: "written" | "pending";
  memory_id?: string;
  pending_id?: number;
  error?: string;
}

export interface WriteInsightResult {
  root_insight_id: string;
  outcomes: ChunkWriteOutcome[];
  /** true if every chunk was either written or safely queued */
  ok: boolean;
}

export interface InvalidateResult {
  status: "invalidated" | "pending";
  invalidated_memory_ids?: string[];
  count?: number;
  pending_id?: number;
  error?: string;
}

export interface FlushResult {
  attempted: number;
  committed: number;
  failed: number;
}

export class EngramWriter {
  constructor(
    private readonly client: EngramMcpClient,
    private readonly queue: PendingWritesQueue,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Compute expires_at per synthesis. Caller may override (e.g. a
   * contradiction-arbitration producer wants 180d). Default 90d per
   * docs/phase-5-open-questions.md §Q2 Decision A.
   */
  computeExpiresAt(base: Date, days: number = DEFAULT_EXPIRES_AT_DAYS): string {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  }

  async writeInsight(
    opts: WriteInsightOptions
  ): Promise<WriteInsightResult> {
    const chunks = splitInsight(opts);
    if (chunks.length === 0) {
      throw new Error("splitInsight returned no chunks — empty content?");
    }
    const rootInsightId = chunks[0]!.source_trace.root_insight_id;
    const expiresAt =
      opts.expiresAt ?? this.computeExpiresAt(this.now());
    const scope = opts.scope ?? "project";

    const outcomes: ChunkWriteOutcome[] = [];

    for (const chunk of chunks) {
      // R3: validate every chunk before it leaves our boundary.
      validateSourceTrace(chunk.source_trace);

      const args = this.buildRememberArgs(
        chunk,
        opts.project,
        scope,
        expiresAt,
        opts.confidence,
        opts.tags
      );

      const result = await this.safeRemember(args);
      if (result.ok && result.data?.id) {
        outcomes.push({
          chunk_index: chunk.source_trace.chunk_index,
          total_chunks: chunk.source_trace.total_chunks,
          status: "written",
          memory_id: result.data.id,
        });
      } else {
        const pendingId = this.queue.enqueue("remember", {
          payload: args as unknown as Record<string, unknown>,
          expiresAt: new Date(expiresAt).getTime(),
        });
        outcomes.push({
          chunk_index: chunk.source_trace.chunk_index,
          total_chunks: chunk.source_trace.total_chunks,
          status: "pending",
          pending_id: pendingId,
          error: result.error,
        });
      }
    }

    return {
      root_insight_id: rootInsightId,
      outcomes,
      ok: outcomes.every(
        (o) => o.status === "written" || o.status === "pending"
      ),
    };
  }

  async invalidateFacts(factIds: string[]): Promise<InvalidateResult> {
    const args = { fact_ids: factIds };
    const result = await this.safeInvalidate(args);
    if (result.ok && result.data) {
      return {
        status: "invalidated",
        invalidated_memory_ids: result.data.invalidated_memory_ids,
        count: result.data.count,
      };
    }
    const pendingId = this.queue.enqueue("invalidate", {
      payload: args as unknown as Record<string, unknown>,
    });
    return { status: "pending", pending_id: pendingId, error: result.error };
  }

  /**
   * Retry pending writes. Commits on success, bumps attempts on failure.
   * Does not raise; caller inspects FlushResult.
   */
  async flushPending(): Promise<FlushResult> {
    const rows = this.queue.listPending();
    let committed = 0;
    let failed = 0;

    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch (e) {
        this.queue.markFailed(row.id, `invalid payload json: ${String(e)}`);
        failed++;
        continue;
      }

      const result =
        row.kind === "remember"
          ? await this.safeRemember(payload as unknown as RememberArgs)
          : await this.safeInvalidate(payload as { fact_ids: string[] });

      if (result.ok) {
        this.queue.markCommitted(row.id);
        committed++;
      } else {
        this.queue.markFailed(row.id, result.error ?? "unknown error");
        failed++;
      }
    }

    return { attempted: rows.length, committed, failed };
  }

  private buildRememberArgs(
    chunk: ChunkedInsight,
    project: string | null,
    scope: "project" | "global" | "meta",
    expiresAt: string,
    confidence: number | undefined,
    tags: string[] | undefined
  ): RememberArgs {
    return {
      origin: "compost",
      kind: "insight",
      content: chunk.content,
      project,
      scope,
      source_trace: chunk.source_trace,
      expires_at: expiresAt,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    };
  }

  private async safeRemember(
    args: RememberArgs
  ): Promise<MCPCallResult<{ id: string }>> {
    try {
      return await this.client.remember(args);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async safeInvalidate(args: {
    fact_ids: string[];
  }): Promise<
    MCPCallResult<{ invalidated_memory_ids: string[]; count: number }>
  > {
    try {
      return await this.client.invalidate(args);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
