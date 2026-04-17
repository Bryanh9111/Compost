# 03 — MCP integration (Claude Code hooks + analysis partner)

This example shows Compost as the analysis partner side of an AI
workflow: Claude Code tool events flow in through the hook-shim, and
Compost surfaces (`ask`, `triage`, `doctor`) give you back
cross-session insight.

## What you will wire up

1. **Hook-shim** — tiny adapter that Claude Code's hook config calls on
   every tool event. It writes envelopes into `observe_outbox` (with PII
   redaction) so the daemon can drain them into observations.
2. **Analysis surfaces** — once events accumulate:
   - `compost ask "<natural language>"` — answers grounded in your own
     session history and any files/URLs you have added.
   - `compost triage` — lists anomalies the health scanners flagged
     (circuit-breaker trips, orphan observations, stale wiki, etc.).
   - `compost doctor --check-integrity` — one-shot audit of fact-links,
     transform-policy drift, and FK integrity.

## Wire Claude Code to the hook-shim

Add this to your Claude Code `settings.json` (path platform-specific):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "bun /ABS/PATH/TO/Compost/packages/compost-hook-shim/src/cli.ts"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "bun /ABS/PATH/TO/Compost/packages/compost-hook-shim/src/cli.ts"
          }
        ]
      }
    ]
  }
}
```

Replace `/ABS/PATH/TO/Compost` with your clone path. The shim reads the
hook JSON from stdin, redacts PII (CC numbers, tokens, .env-shaped
strings, password lines), and appends one outbox row per event.

Every observation produced this way carries:

- `adapter = 'claude-code'`
- `method = 'claude-code'`
- `origin_hash` anchored to the hook session so repeated tool calls in
  the same session cluster together by inlet signature.

## Use the analysis-partner surfaces

After a few sessions of Claude Code traffic have flowed in:

```bash
# Natural-language recall across sessions
compost ask "What were the migration decisions I debated this month?"

# Anomalies the daemon scanners have flagged
compost triage

# One-shot integrity audit
compost doctor --check-integrity

# One-shot PII scan (safety net on top of the hook-shim redactor)
compost doctor --check-pii
```

`ask` is the key analysis-partner surface. It does cross-fact reasoning
over the grounded corpus — the idea is not "autocomplete" but "show me
what I have already decided on this topic, and where the evidence
lives." If the answer grounds insufficiently, it downgrades to BM25 over
the raw chunks instead of hallucinating.

## Verify the hook is working

```bash
# Tail recent envelopes
sqlite3 ~/.compost/ledger.db \
  "SELECT adapter, source_kind, substr(payload, 1, 80) AS preview
   FROM observe_outbox
   ORDER BY seq DESC LIMIT 3"
```

If the shim is wired correctly, every Claude Code tool call produces a
row here within a few milliseconds.

## What this is NOT

- Not a Claude Desktop MCP server — this is the hook-shim path. An MCP
  server surface is a separate Phase-5+ item.
- Not a real-time push surface — ingest is pull/drain. Notifications /
  proactive push arrive in Phase 6 (Curiosity + Gap trackers).
