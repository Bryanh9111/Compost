#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> compost install"

# Dependency checks
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found. Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

# Guardrail: ~/.compost must live on local disk (debate #1 requirement).
# Sync services corrupt WAL mode and break the portability invariant.
# See docs/portability.md.
COMPOST_DIR="${HOME}/.compost"
case "$COMPOST_DIR" in
  *Dropbox*|*iCloud*|*OneDrive*|*"Google Drive"*)
    echo "ERROR: ~/.compost must be on local disk. Detected sync service path: $COMPOST_DIR"
    echo "See docs/portability.md for the local-disk-only constraint."
    exit 1
    ;;
esac

# Node workspaces
echo "==> installing Node workspaces"
bun install

# Data directory setup (idempotent - mkdir -p and chmod are safe to repeat)
echo "==> creating data directory"
mkdir -p "${COMPOST_DIR}"/{blobs,wiki,logs}

echo "==> locking down permissions (chmod 700 - owner only)"
chmod 700 "${COMPOST_DIR}"
chmod 700 "${COMPOST_DIR}/blobs"
chmod 700 "${COMPOST_DIR}/wiki"
chmod 700 "${COMPOST_DIR}/logs"
# Rationale: ~/.compost holds the user's entire ingested memory. Default macOS
# umask 022 creates world-readable dirs. chmod 700 closes the multi-user-machine
# data leak. See §9 of compost-v2-spec.md.

# Initialize ledger.db: run SQL migrations then upsert policies registry.
# applyMigrations runs 0001..0004 in order; upsertPolicies syncs the TS
# registry into the `policies` SQL table before any writer can connect.
# This block is idempotent: migrations use CREATE TABLE IF NOT EXISTS and
# upsertPolicies uses INSERT OR REPLACE.
echo "==> applying L0 schema and policies"
bun run --cwd packages/compost-core schema:apply
# If compost-core is not yet scaffolded, fall back to the inline bootstrap:
# bun --eval "
#   import { applyMigrations, upsertPolicies } from './packages/compost-core/src/schema/migrate.ts';
#   await applyMigrations('${COMPOST_DIR}/ledger.db');
#   await upsertPolicies('${COMPOST_DIR}/ledger.db');
# "

# Python venv for compost-ingest
echo "==> installing Python compost_ingest (uv sync)"
( cd packages/compost-ingest && uv sync )

# Cold-start measurement (non-blocking for now - prints results, does not fail install).
# Phase 0 DoD requires p95 <= 30ms. The install gate will be hardened once
# compost-hook-shim is built; at that point this line should be:
#   bun run --cwd packages/compost-cli -- doctor --measure-hook
# and installation should fail if p95 > 30ms.
echo "==> measuring compost hook cold start (non-blocking)"
if bun run --cwd packages/compost-cli -- doctor --measure-hook 2>/dev/null; then
  echo "    cold-start measurement passed"
else
  echo "    WARNING: compost doctor --measure-hook is not yet available (expected before Phase 0 DoD)"
  echo "    Once built, p95 must be <= 30ms on reference hardware (see docs/compost-v2-spec.md §11)"
fi

echo ""
echo "==> done."
echo ""
echo "Try: compost daemon start --help"
echo ""
echo "To integrate with Claude Code, add this to ~/.claude/settings.json:"
echo '  "hooks": ['
echo '    { "event": "SessionStart",     "command": "compost hook session-start",     "timeout": 5000 },'
echo '    { "event": "UserPromptSubmit", "command": "compost hook user-prompt-submit", "timeout": 5000 },'
echo '    { "event": "PreToolUse",       "command": "compost hook pre-tool-use",       "timeout": 5000 },'
echo '    { "event": "PostToolUse",      "command": "compost hook post-tool-use",      "timeout": 5000 },'
echo '    { "event": "Stop",             "command": "compost hook stop",               "timeout": 5000 }'
echo '  ]'
