import {
  EngramWriter,
  type EngramMcpClient,
  type WriteInsightResult,
} from "../../compost-engram-adapter/src/writer";
import { PendingWritesQueue } from "../../compost-engram-adapter/src/pending-writes";
import {
  digestInsightInput,
  type DigestReport,
} from "../../compost-core/src/cognitive/digest";

/**
 * Phase 6 P0 slice 2 Round B — push a digest report to Engram as
 * `kind=insight`, `scope=meta`. Designed to mirror `runEngramFlushOnce`
 * so CLI can call it single-shot and dogfood the S6-2 MCP write
 * transport without plugging into the daemon scheduler.
 *
 * Fact-lite digests (wiki-only / resolved-gap-only with no fact
 * back-refs) yield `skipped-empty` — Engram R3 requires
 * `compost_fact_ids` min(1). Slice 3 will add wiki provenance via
 * `decision_audit.evidence_refs_json` so wiki-only reports can also
 * push (see debates/022-wiki-only-digest-shaping/synthesis.md).
 */

export interface DigestPushOptions {
  mcpClient: EngramMcpClient;
  queue: PendingWritesQueue;
  report: DigestReport;
  /** Engram memory scope. Default `meta` — digest is not a project fact. */
  scope?: "meta" | "project" | "global";
  /** Tag set. Default `["digest"]`. */
  tags?: string[];
  /** Project name if caller wants to scope the insight. Default null. */
  project?: string | null;
}

export type DigestPushOutcome =
  | { status: "skipped-empty"; reason: "no_insight_input" }
  | { status: "pushed"; result: WriteInsightResult };

export async function runDigestPushOnce(
  opts: DigestPushOptions
): Promise<DigestPushOutcome> {
  const insight = digestInsightInput(opts.report);
  if (!insight) {
    return { status: "skipped-empty", reason: "no_insight_input" };
  }

  const writer = new EngramWriter(opts.mcpClient, opts.queue);
  const result = await writer.writeInsight({
    project: opts.project ?? null,
    compostFactIds: insight.compostFactIds,
    content: insight.content,
    synthesizedAt: insight.synthesizedAt,
    scope: opts.scope ?? "meta",
    tags: opts.tags ?? ["digest"],
  });

  return { status: "pushed", result };
}
