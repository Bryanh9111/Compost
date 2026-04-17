import { describe, test, expect } from "bun:test";
import { scrub, scrubEnvelope } from "../src/pii";

describe("pii.scrub — credit cards (Luhn-validated)", () => {
  test("redacts valid Visa number", () => {
    const { scrubbed, redactions } = scrub("My card is 4532015112830366");
    expect(scrubbed).not.toContain("4532015112830366");
    expect(scrubbed).toContain("[REDACTED_CC]");
    expect(redactions).toBe(1);
  });

  test("redacts spaced credit card", () => {
    const { scrubbed, redactions } = scrub("card: 4532 0151 1283 0366 expiry");
    expect(scrubbed).toContain("[REDACTED_CC]");
    expect(redactions).toBe(1);
    expect(scrubbed).toContain("card:");
    expect(scrubbed).toContain("expiry");
  });

  test("preserves non-Luhn 13-digit sequence (e.g. order number)", () => {
    const { scrubbed, redactions } = scrub("Order #1234567890123");
    expect(scrubbed).toContain("1234567890123");
    expect(redactions).toBe(0);
  });

  test("preserves short number sequences", () => {
    const { scrubbed, redactions } = scrub("Port 5432 and 8080");
    expect(redactions).toBe(0);
    expect(scrubbed).toBe("Port 5432 and 8080");
  });
});

describe("pii.scrub — API tokens", () => {
  test("redacts Anthropic sk-ant key", () => {
    const { scrubbed, redactions } = scrub(
      "API: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"
    );
    expect(scrubbed).not.toContain("sk-ant-api03");
    expect(scrubbed).toContain("[REDACTED_TOKEN]");
    expect(redactions).toBe(1);
  });

  test("redacts GitHub classic PAT (ghp_)", () => {
    const { scrubbed, redactions } = scrub(
      "token=ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    );
    expect(scrubbed).toContain("[REDACTED_TOKEN]");
    expect(scrubbed).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
    expect(redactions).toBe(1);
  });

  test("redacts AWS access key AKIA", () => {
    const { scrubbed, redactions } = scrub(
      "AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE in config"
    );
    expect(scrubbed).toContain("[REDACTED_TOKEN]");
    expect(redactions).toBeGreaterThanOrEqual(1);
  });

  test("redacts Google API key AIza", () => {
    const { scrubbed, redactions } = scrub(
      "key: AIzaSyDxyz0123456789abcdef0123456789ABCDEFG end"
    );
    expect(scrubbed).toContain("[REDACTED_TOKEN]");
    expect(redactions).toBe(1);
  });

  test("redacts Slack token xoxb-", () => {
    const { scrubbed, redactions } = scrub(
      "SLACK=xoxb-1234-5678-abcdefghijklmnop"
    );
    expect(scrubbed).toContain("[REDACTED_TOKEN]");
    expect(redactions).toBeGreaterThanOrEqual(1);
  });
});

describe("pii.scrub — SSH / PGP private key blocks", () => {
  test("redacts RSA private key block", () => {
    const body = `here is my key:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0zF4fakekeyfakekeyfakekey
linewithdata
-----END RSA PRIVATE KEY-----
end.`;
    const { scrubbed, redactions } = scrub(body);
    expect(scrubbed).toContain("[REDACTED_PRIVATE_KEY]");
    expect(scrubbed).not.toContain("MIIEpAIBAAKCAQEA");
    expect(scrubbed).not.toContain("linewithdata");
    expect(redactions).toBe(1);
  });

  test("redacts OPENSSH private key block", () => {
    const body = `-----BEGIN OPENSSH PRIVATE KEY-----
abc123
-----END OPENSSH PRIVATE KEY-----`;
    const { scrubbed } = scrub(body);
    expect(scrubbed).toContain("[REDACTED_PRIVATE_KEY]");
    expect(scrubbed).not.toContain("abc123");
  });

  test("redacts EC private key", () => {
    const body = `-----BEGIN EC PRIVATE KEY-----
xxxxx
-----END EC PRIVATE KEY-----`;
    const { scrubbed } = scrub(body);
    expect(scrubbed).toContain("[REDACTED_PRIVATE_KEY]");
  });
});

describe("pii.scrub — env-style KEY=value", () => {
  test("redacts SECRET=value", () => {
    const { scrubbed, redactions } = scrub("SECRET=mysupersecretvalue");
    expect(scrubbed).toContain("SECRET=[REDACTED]");
    expect(scrubbed).not.toContain("mysupersecretvalue");
    expect(redactions).toBe(1);
  });

  test("redacts DB_PASSWORD=xxx (prefix matches)", () => {
    const { scrubbed } = scrub("DB_PASSWORD=hunter2");
    expect(scrubbed).toContain("PASSWORD=[REDACTED]");
    expect(scrubbed).not.toContain("hunter2");
  });

  test("redacts CLIENT_SECRET=xxx", () => {
    const { scrubbed } = scrub("CLIENT_SECRET=oauth_secret_xyz");
    expect(scrubbed).toContain("CLIENT_SECRET=[REDACTED]");
  });

  test("redacts generic password: form", () => {
    const { scrubbed } = scrub("password: hunter2");
    expect(scrubbed).toContain("[REDACTED]");
    expect(scrubbed).not.toContain("hunter2");
  });

  test("case insensitive password match", () => {
    const { scrubbed } = scrub("Password: mypass123");
    expect(scrubbed).toContain("[REDACTED]");
  });
});

describe("pii.scrub — bearer tokens", () => {
  test("redacts Bearer authorization", () => {
    const { scrubbed, redactions } = scrub(
      "Authorization: Bearer abc.def.ghijklmnopqrstuv"
    );
    expect(scrubbed).toContain("Bearer [REDACTED_TOKEN]");
    expect(scrubbed).not.toContain("abc.def.ghijklmnopqrstuv");
    expect(redactions).toBe(1);
  });
});

describe("pii.scrub — edge cases", () => {
  test("plain text passes through unchanged", () => {
    const input = "Hello world, this is safe text.";
    const { scrubbed, redactions } = scrub(input);
    expect(scrubbed).toBe(input);
    expect(redactions).toBe(0);
  });

  test("idempotent: scrub(scrub(x)) === scrub(x)", () => {
    const x =
      "My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const once = scrub(x).scrubbed;
    const twice = scrub(once).scrubbed;
    expect(twice).toBe(once);
  });

  test("multiple patterns in one string", () => {
    const { redactions } = scrub(
      "CC 4532015112830366 and token ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    );
    expect(redactions).toBeGreaterThanOrEqual(2);
  });

  test("empty string", () => {
    const { scrubbed, redactions } = scrub("");
    expect(scrubbed).toBe("");
    expect(redactions).toBe(0);
  });

  test("strict mode redacts raw 13-19 digit sequences", () => {
    const input = "Order #1234567890123 customer ref";
    const normal = scrub(input);
    const strict = scrub(input, { strict: true });
    expect(normal.redactions).toBe(0);
    expect(strict.redactions).toBe(1);
    expect(strict.scrubbed).toContain("[REDACTED_CC]");
  });

  test("known limitation: homograph bypass documented", () => {
    // Cyrillic 'о' (U+043E) looks like Latin 'o' but is a different code point.
    // Current implementation cannot defend against this — document the limit.
    const { scrubbed } = scrub("passwоrd: secret");
    // Current implementation misses this — test documents known gap.
    // If strict mode catches it in future, update expectation.
    expect(scrubbed).toBeDefined();
  });
});

describe("pii.scrubEnvelope", () => {
  test("scrubs payload, leaves metadata/envelope meta fields untouched", () => {
    const env = {
      hook_event_name: "PreToolUse",
      session_id: "abc-123",
      cwd: "/tmp/project",
      timestamp: "2026-04-16T00:00:00Z",
      payload: {
        tool_input: { command: "cat .env" },
        secret: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      },
      metadata: { hook_event: "PreToolUse" },
    };
    const result = scrubEnvelope(env);
    expect(JSON.stringify(result.envelope.payload)).not.toContain("sk-ant");
    expect(result.envelope.metadata).toEqual(env.metadata);
    expect(result.envelope.hook_event_name).toBe("PreToolUse");
    expect(result.envelope.session_id).toBe("abc-123");
    expect(result.redactions).toBeGreaterThanOrEqual(1);
  });

  test("preserves envelope when payload is clean", () => {
    const env = {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/tmp",
      timestamp: "2026-04-16T00:00:00Z",
      payload: { plain: "data" },
    };
    const result = scrubEnvelope(env);
    expect(result.envelope.payload).toEqual({ plain: "data" });
    expect(result.redactions).toBe(0);
  });

  test("handles empty payload", () => {
    const env = {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/tmp",
      timestamp: "2026-04-16T00:00:00Z",
      payload: {},
    };
    const result = scrubEnvelope(env);
    expect(result.envelope.payload).toEqual({});
    expect(result.redactions).toBe(0);
  });
});
