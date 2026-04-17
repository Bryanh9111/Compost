/**
 * PII redactor for hook-shim payloads.
 *
 * Scope: regex-based blocklist invoked before writing to observe_outbox.
 * Patterns covered: credit cards (Luhn-validated), SSH/PGP private key blocks,
 * API tokens (Anthropic/OpenAI/GitHub/AWS/Google/Slack/Bearer), env-style
 * KEY=value (SECRET, PASSWORD, TOKEN, APIKEY, CLIENT_SECRET, ...), and
 * `password: xxx` colon/equals forms.
 *
 * Limitations (documented):
 *   - Cannot defend against homograph attacks (Cyrillic 'о' vs Latin 'o').
 *   - Cannot detect novel token formats not in the blocklist.
 *   - Strict mode adds 13-19 digit sequence matching even without Luhn (more
 *     false positives, but catches non-CC tabular data leaks).
 *
 * Usage: triggered by hook-shim on every envelope before INSERT INTO
 * observe_outbox. `COMPOST_PII_STRICT=true` env enables strict mode.
 */

const REDACTED_CC = "[REDACTED_CC]";
const REDACTED_TOKEN = "[REDACTED_TOKEN]";
const REDACTED_KEY = "[REDACTED_PRIVATE_KEY]";
const REDACTED_GENERIC = "[REDACTED]";

/** Luhn algorithm for credit card number validation. */
function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, "");
  if (nums.length < 13 || nums.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    const ch = nums[i];
    if (ch === undefined) continue;
    let n = parseInt(ch, 10);
    if (isNaN(n)) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export interface ScrubResult {
  scrubbed: string;
  redactions: number;
}

export interface ScrubOpts {
  strict?: boolean;
}

export function scrub(input: string, opts: ScrubOpts = {}): ScrubResult {
  let out = input;
  let count = 0;

  // 1. SSH / PGP private key blocks (multi-line, highest priority to consume large spans).
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    () => {
      count++;
      return REDACTED_KEY;
    }
  );

  // 2. Bearer tokens — replace entire "Bearer <token>" with "Bearer [REDACTED_TOKEN]".
  out = out.replace(
    /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}/g,
    () => {
      count++;
      return `Bearer ${REDACTED_TOKEN}`;
    }
  );

  // 3. API tokens (specific prefixes). Ordered longer-prefix-first to avoid
  //    the generic sk- pattern swallowing sk-ant-.
  const tokenPatterns: RegExp[] = [
    /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic
    /sk-[A-Za-z0-9]{20,}/g, // OpenAI (general)
    /github_pat_[A-Za-z0-9_]{80,}/g, // GitHub fine-grained PAT
    /ghp_[A-Za-z0-9]{36,}/g, // GitHub classic PAT
    /AKIA[0-9A-Z]{16}/g, // AWS access key
    /AIza[0-9A-Za-z_-]{35}/g, // Google API key
    /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  ];
  for (const re of tokenPatterns) {
    out = out.replace(re, () => {
      count++;
      return REDACTED_TOKEN;
    });
  }

  // 4. Credit card numbers (Luhn-validated, 13-19 digits with optional spaces/hyphens).
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (luhnCheck(digits)) {
      count++;
      return REDACTED_CC;
    }
    return match;
  });

  // 5. .env-style KEY=value for sensitive keys (includes common prefixes like DB_PASSWORD).
  const envKeyRegex =
    /\b([A-Z_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET))\s*=\s*\S+/gi;
  out = out.replace(envKeyRegex, (match, p1) => {
    // Skip if value was already redacted by a more specific token rule
    // (prevents "token=[REDACTED_TOKEN]" being downgraded to "TOKEN=[REDACTED]").
    if (match.includes("REDACTED")) return match;
    count++;
    return `${String(p1)}=${REDACTED_GENERIC}`;
  });

  // 6. "password: xxx" / "passwd: xxx" colon or equals form (case insensitive).
  //    Only replace when the keyword is followed by a colon+value.
  const passwordRegex = /\b(password|passwd)\s*[:=]\s*\S+/gi;
  out = out.replace(passwordRegex, (match, p1) => {
    if (match.includes("REDACTED")) return match;
    count++;
    return `${p1}:${REDACTED_GENERIC}`;
  });

  // 7. Strict mode: additionally redact any raw 13-19 digit sequence
  //    (catches non-CC tabular leaks like support IDs containing CC-like
  //    strings). Default off because it has higher false-positive rate.
  if (opts.strict) {
    out = out.replace(/\b\d{13,19}\b/g, (match) => {
      // Avoid double-counting if already redacted to placeholder.
      if (match.includes("REDACTED")) return match;
      count++;
      return REDACTED_CC;
    });
  }

  return { scrubbed: out, redactions: count };
}

export interface Envelope {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ScrubEnvelopeResult {
  envelope: Envelope;
  redactions: number;
}

export function scrubEnvelope(
  envelope: Envelope,
  opts: ScrubOpts = {}
): ScrubEnvelopeResult {
  const payloadStr = JSON.stringify(envelope.payload ?? {});
  const { scrubbed, redactions } = scrub(payloadStr, opts);

  let scrubbedPayload: Record<string, unknown>;
  try {
    scrubbedPayload = JSON.parse(scrubbed);
  } catch {
    // Redaction broke JSON structure (rare; happens if a secret contained
    // unescaped braces). Fall back to wrapping the full redacted string.
    scrubbedPayload = { _redacted_raw: scrubbed };
  }

  return {
    envelope: { ...envelope, payload: scrubbedPayload },
    redactions,
  };
}
