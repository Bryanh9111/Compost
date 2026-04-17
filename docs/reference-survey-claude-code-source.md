# Reference Survey — Claude Code Source *(removed for open-source)*

> The full content of this reference survey was part of internal research and
> was removed before open-sourcing Compost.
>
> This stub preserves the file path so that existing references in `compost-v2-spec.md`,
> `debate4/`, `debate5/`, and other documents do not become broken links.

## What this document originally contained

A deep dive into the Claude Code CLI source code focused on its hook system —
specifically the hook envelope format (JSON payload passed to hook commands
on stdin), task registration model, and completion delivery via
`queued_command` attachments.

Compost's hook-shim (`packages/compost-hook-shim/`) relies on this envelope
format. The source-of-truth reference is now the **upstream Claude Code
documentation**, not this file.

## Where to look for the same information today

- [Claude Code official documentation](https://docs.anthropic.com/en/docs/claude-code) — hook system overview
- [Anthropic Claude Code repository](https://github.com/anthropics/claude-code) — hook envelope source code
- `packages/compost-hook-shim/src/index.ts` in this repo — see `HookEnvelope` interface for the fields Compost depends on

## If you need the original internal survey

It is not published. If you are the repo owner and need the pre-removal content,
check git history on a private branch prior to the open-source sanitization commit.

## Broken-link targets (do not chase these)

Sections referenced by name but no longer present in this document:

- `§Hook System Deep Dive`
- `§3b.2` (payload shape)
- Specific line ranges (e.g. `:71-110`, `:82-104`) in review documents

These references predate the removal. They describe behavior documented
upstream — treat them as pointers to the Claude Code source code / docs,
not to this file.
