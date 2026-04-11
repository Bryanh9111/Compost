# Claude Code Source Survey — CLI Architecture Patterns for Compost

**Source**: `/Users/zion/Repos/Personal/Research-and-Integration/memory/claude-code-source/claude-code`
**Focus**: CLI architecture, hook system, settings cascade, MCP client, task tracking
**Generated**: 2026-04-11

---

## TL;DR

Claude Code is a monolithic TypeScript/React CLI built with **Bun** as runtime and **Commander.js** for command dispatch. Unlike a typical CLI, it combines a **stateless one-shot mode** (`-p/--print`) with an **interactive REPL** that maintains session state, agent contexts, and long-running async hooks. It uses a **fire-and-forget async hook system** (spawned as child processes) for extensibility, a **hierarchical settings cascade** (managed/policy > project > user), and **MCP clients** for pluggable tool/resource backends. The core novelty is treating the CLI as a thin client to a React rendering engine for terminal UI, with session persistence via SQLite and transcript files.

---

## Package/Binary Layout

**Root entry**: `src/entrypoints/cli.tsx` (line 1)

**CLI binary setup** (package.json line 10):
```json
"bin": { "claude": "src/entrypoints/cli.tsx" }
```

**Build tool**: Bun 1.1.0+ (package.json lines 125-127). Built with bun esbuild plugin.

**Key runtime libraries**:
- `@commander-js/extra-typings` — command dispatch
- `@modelcontextprotocol/sdk` — MCP client
- `better-sqlite3` — session/transcript persistence
- `react` + `react-reconciler` — terminal UI rendering (Ink-like)
- `chalk`, `node-pty`, `pino`, `vscode-jsonrpc`

**Main fast-path flows** in cli.tsx:
1. Version/early exits (lines 37-93)
2. Daemon subcommand (lines 164-180)
3. Background sessions (ps/logs/attach/kill, lines 182-208)
4. Main CLI load (line 294)

---

## Command Dispatch and REPL

Commander.js with feature-gated fast-paths.

**Dispatch flow** (`src/entrypoints/cli.tsx` lines 33-298):

1. **Bootstrap** (lines 33-34): Parse `process.argv.slice(2)`, detect special flags
2. **Fast-path checks** (lines 37-274): Short-circuit for `--version`, `--daemon`, `--bg`, etc.
3. **Main CLI load** (lines 288-297): Dynamic import of `main.tsx` only after fast-path checks fail
4. **Commander program setup** (`main.tsx` line 22): `new CommanderCommand()` + `.option()` + `.command()` chains
5. **REPL launcher** (`replLauncher.ts`): `launchRepl()` spawns interactive session with React rendering

**TTY / one-shot vs REPL**:
- Non-interactive: `-p/--print` flag (main.tsx line 276) — parse, call API, exit. No React.
- Interactive: Ink-based terminal UI (React reconciler) with message history, tool call results. Session ID in session registry at `~/.claude/sessions/`.

---

## Hook System Deep Dive

**Hook event types** (`src/types/hooks.ts` lines 1-291):
- `SessionStart` — source: startup, resume, clear, compact
- `UserPromptSubmit` — before prompt sent to model
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure`
- `Stop`, `StopFailure` — response end / error
- `SubagentStart`
- `PermissionRequest`, `PermissionDenied`
- `FileChanged`, `CwdChanged`
- ~10 more (Notification, Setup, Elicitation, etc.)

**Hook response contract** (lines 50-166):
```typescript
// Sync response
{
  continue?: boolean,
  suppressOutput?: boolean,
  stopReason?: string,
  decision?: 'approve' | 'block',
  hookSpecificOutput?: { hookEventName, ... }
}

// Async response
{ async: true, asyncTimeout?: number }
```

**Registration** (`utils/hooks/hooksSettings.ts`):
- Hooks loaded from `~/.claude/settings.json` under `hooks[]` array
- Each hook: `command` (shell/HTTP), `matcher` (tool_name, event, source), `timeout`
- Settings cascade: managed → policy → project → user

**Dispatch flow** (`utils/hooks.ts` lines 150-250):

1. Hook event fires (e.g., PreToolUse during tool call)
2. `executeHooks()` with event type + input (tool name, args)
3. For each matching hook:
   - Serialize input as JSON to stdin
   - Spawn hook command as child process (bash or HTTP POST)
   - Capture stdout/stderr
4. **Exit code semantics**:
   - **0**: Success, stdout shown to model
   - **2**: Blocking error, stderr shown to user, action halted
   - **Other**: Non-blocking, stderr shown to user only
5. If `async: true`: register hook in `AsyncHookRegistry`; completion triggers model notification via `queued_command` attachments
6. Hook output injected into conversation or model context

**Key details**:
- Hooks can modify tool inputs (`updatedInput` in response)
- Hooks can block/allow actions (`decision: 'approve'/'block'`)
- Async hooks fire-and-forget; completion enqueued as task notifications
- Default hook timeout: `TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 min`
- Session hooks isolated per session; cleared on `SessionEnd`

---

## Settings + CLAUDE.md Loading

**Cascade precedence** (lowest to highest, `utils/settings/settings.ts` lines 55-150):

1. **Managed file settings** (admin-controlled):
   - Base: `$MANAGED_SETTINGS_DIR/managed-settings.json`
   - Drop-ins: `$MANAGED_SETTINGS_DIR/managed-settings.d/*.json` (alphabetically merged)
   - MDM overrides on macOS/Windows

2. **Policy settings** (org/team): remote service, cached locally

3. **Project settings**: `.claude/settings.json` in project root, ancestor walk

4. **User settings**: `~/.claude/settings.json` (lowest precedence)

**Merge logic** (line 87):
- lodash `mergeWith()` + custom `settingsMergeCustomizer`
- Arrays replaced (not concatenated), objects deep-merged
- Later sources override earlier

**CLAUDE.md auto-discovery** (main.tsx lines 105-106, 141):
- Looked up from project root or `--add-dir`
- Injected as `nested_memory` attachment in system context
- Read-only for subagents

**Config init** (`utils/config.ts`):
- `enableConfigs()` called early
- Parallelized: MDM read + keychain reads happen before main imports
- Validation via Zod schema

---

## MCP Client Architecture

**Instantiation** (`services/mcp/client.ts` lines 1-150):

1. **Transport layer** (lines 9-21):
   - `StdioClientTransport` (child process stdio)
   - `SSEClientTransport` (Server-Sent Events)
   - `StreamableHTTPClientTransport` (HTTP chunked)
   - `WebSocketTransport` (custom)

2. **Client creation**:
```typescript
const client = new Client({ name: 'claude-code', version: '0.0.0' });
const transport = new StdioClientTransport({...});
await client.connect(transport);
```

3. **Server lifecycle**:
   - Listed in `.claude/settings.json` or managed
   - On session start: all non-disabled servers connected in parallel
   - `connectToServer()` memoized; shared across tools
   - On session end: cleanup via `registerCleanup()` handlers

4. **Tool call routing** (lines 22-56):
   - `ListToolsResult` fetched from each server
   - Tools exposed as `MCPTool` wrapper (standard Tool interface)
   - Tool call → `callTool()` on MCP client → JSON-RPC over transport
   - Result validation + truncation if >500KB

5. **OAuth/Auth** (`services/mcp/auth.ts`): `ClaudeAuthProvider` handles token refresh; hook system can modify tool I/O before MCP call

**Lifecycle hooks** (lines 109-111):
- Pre-tool: `runElicitationHooks()` for tool use validation
- Post-tool: result capture for hooks
- Failure: error propagation with permission checks

---

## Background Tasks + Subagents

**Task registry** (`utils/tasks.ts`):
- File-based: `~/.claude/teams/{teamId}/tasks/`
- Each task: JSON file with id, subject, status, owner, blocks/blockedBy
- High water mark file tracks max ID ever assigned
- Async file locking (retries up to 30x with backoff, lines 102-108)

**Subagent dispatch** (`tools/AgentTool/runAgent.ts` lines 85-160):

1. **Agent definition loading**:
   - Built-in: plan, explore, verify (bundled, minimal tools)
   - Custom: user/plugin-provided (full tool access)
   - Frontmatter: YAML with mcpServers, system prompt tweaks, read-only flags

2. **Subagent MCP servers** (lines 95-127):
   - Agents can define additive MCP servers in frontmatter
   - Merged with parent servers; newly-created cleaned up on finish
   - Admin-trusted agents always load frontmatter MCP
   - User agents respect `strictPluginOnlyCustomization` policy

3. **Context isolation** (`utils/forkedAgent.ts`):
   - Same process, separate AppState
   - Transcript recorded separately (`setAgentTranscriptSubdir()`)
   - File state cache cloned per agent
   - CLAUDE.md NOT passed to read-only agents (saves ~5-15 Gtok/week)

4. **Output capture** (runAgent.ts lines 1-84):
   - Agent runs full query loop
   - Messages returned to parent
   - Async hook `SubagentStart` fired before agent runs (line 57)

---

## Top 5 Patterns Compost CLI Should Steal

### 1. Feature-gated fast-path CLI bootstrap
`src/entrypoints/cli.tsx` lines 21-298 — fast paths before full main import (`--version`, `--daemon`, special flags). Defers heavy module loading until necessary.

**For Compost**: `compost --version` exits in <50ms, `compost daemon start` loads daemon code only. `compost hook <event>` stays lightweight to minimize hook overhead.

### 2. Commander.js with extra typings
`main.tsx` line 22 — type-safe command + option definitions, `.command()` chains with `.action()` async handlers, auto-generated help.

**For Compost**: Use `@commander-js/extra-typings`. Subcommands: `compost daemon`, `compost add`, `compost query`, `compost recall`, `compost doctor`, `compost hook`.

### 3. Hierarchical settings cascade with file merging
`utils/settings/settings.ts` lines 55-150 — Managed > Policy > Project > User. Drop-in directory pattern for managed settings (systemd-like). Zod validation at each layer.

**For Compost**: `$COMPOST_MANAGED/managed.json` > `./.compost/settings.json` (project) > `~/.compost/settings.json` (user). Use Zod for schema validation.

### 4. JSONL-over-stdio hook contract with exit codes
`utils/hooks.ts` lines 184-250 — input JSON to stdin, output JSON from stdout, exit code semantics (0=pass, 2=block, other=non-blocking), async mode via `{async: true}`.

**For Compost**: Adapters become hook subscribers. The `compost hook <event>` subcommand reads JSON from stdin, writes to local outbox + notifies daemon. Claude Code's settings.json points its `SessionStart`/`Stop` hooks at `compost hook session-start` and `compost hook stop`. Zero MCP overhead for write-path; MCP reserved for `compost.query` read-path.

### 5. Async hook registry with background task tracking
`utils/hooks/AsyncHookRegistry.ts` + `utils/tasks.ts` lines 17-68 — fire-and-forget async hooks spawn child processes, completion enqueued as task notifications, file-based registry prevents lost notifications.

**For Compost**: Async ingest pipeline stages queue completion events to task registry; reflection loop subscribes to task updates. Handles long-running Python extraction without blocking the caller.

---

## Top 3 Things NOT to Copy

### 1. React + Ink terminal rendering
Claude Code re-renders the full TUI on each state change. Overkill for Compost: a daemon needs minimal UI (just logs).

**Instead**: Use Pino for structured logging. Daemon outputs JSONL to stdout (parseable by client commands). No React.

### 2. Monolithic AppState context
Claude Code couples session state (messages, tools, permissions, MCP clients) in one giant store. Compost is a distributed system: daemon state, adapter state, client state are separate.

**Instead**: Message-passing (JSONL-RPC over stdio) to decouple daemon ↔ adapter ↔ CLI client. Each process owns its state.

### 3. Bun-specific bundle tooling
Claude Code uses Bun as primary runtime with `bun esbuild`. Compost targets Node.js + Deno portability.

**Instead**: esbuild directly (not bun's wrapper), or swc. Publish as npm package. Avoid Bun-only features (no `bun:test`, no top-level await without module flag).

---

## Key File References

| Purpose | Path |
|---|---|
| CLI entry | `src/entrypoints/cli.tsx` |
| Hook types | `src/types/hooks.ts` |
| Hook dispatch | `src/utils/hooks.ts` |
| Settings cascade | `src/utils/settings/settings.ts` |
| MCP client | `src/services/mcp/client.ts` |
| Subagent dispatch | `src/tools/AgentTool/runAgent.ts` |
| Task registry | `src/utils/tasks.ts` |
| Main CLI | `src/main.tsx` |

All paths are relative to `/Users/zion/Repos/Personal/Research-and-Integration/memory/claude-code-source/claude-code/`.
