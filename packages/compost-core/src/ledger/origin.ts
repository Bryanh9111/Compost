/**
 * Inlet-origin hash helper (Migration 0014).
 *
 * origin_hash is SHA-256 of `adapter|source_uri|idempotency_key`. It is the
 * stable inlet-signature hash — distinct from content_hash (of the content)
 * and raw_hash (of the outbox payload envelope). Reconstructible from fields
 * already stored on every observation, which is what makes backfill possible.
 *
 * The pipe-separator `|` is acceptable because `adapter` is a controlled
 * vocabulary (local-file / web-url / claude-code / host-adapter / sensory)
 * that never contains `|`.
 */
export function computeOriginHash(
  adapter: string,
  sourceUri: string,
  idempotencyKey: string
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${adapter}|${sourceUri}|${idempotencyKey}`);
  return hasher.digest("hex");
}
