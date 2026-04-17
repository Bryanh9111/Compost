import { homedir } from "os";
import { join } from "path";

// UUIDv5 namespace for deterministic root_insight_id generation.
// Fixed once; changing it breaks idempotency across re-synthesis of the same
// fact set (every root_insight_id would rotate, causing duplicate writes to
// Engram instead of updates). See debate 020 R4.
//
// Generated via uuidv4(), then frozen: 2026-04-17.
export const COMPOST_INSIGHT_UUID_NAMESPACE =
  "9e8d4b12-7f3a-4c6e-b2a1-5d8e0f3c7a9b" as const;

// Default expires_at offset for origin=compost entries Compost writes to
// Engram. 90 days = quarterly review cadence; overridable per synthesis
// producer (see docs/phase-5-open-questions.md §Q2 Decision A).
export const DEFAULT_EXPIRES_AT_DAYS = 90;

// Engram schema caps origin=compost content at 2000 chars. Content exceeding
// this MUST be chunked via splitter. General cap on other kinds is 4000 but
// Compost self-splits to this narrower bound (contract §Compost→Engram).
export const MAX_CONTENT_CHARS = 2000;

// Similarity ceiling for adjacent chunks. Engram's _map_insight_sources uses
// INSERT OR IGNORE with content-similarity dedupe (merge_threshold=0.75 per
// Engram commit 4886f36). Adjacent chunks crossing this threshold will be
// silently merged, breaking total_chunks semantics. See debate 020 R6.
export const ADJACENT_CHUNK_SIMILARITY_CEILING = 0.75;

// Offline queue location. Relative paths not allowed: daemon and CLI may
// chdir. Default to user home; overridable via env for tests.
export const DEFAULT_PENDING_DB_PATH = join(
  homedir(),
  ".compost",
  "pending-engram-writes.db"
);

// MCP transport limit on stream_for_compost batches. Compost must poll in
// rounds; this is the server default (Engram ARCHITECTURE.md §7.1).
export const STREAM_FOR_COMPOST_DEFAULT_LIMIT = 1000;
