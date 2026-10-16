#!/bin/zsh
set -u
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Watch Obsidian vault markdown files and forward note-change metadata to
# `compost capture obsidian`. Uses fswatch when available; otherwise falls back
# to a lightweight polling loop. Set COMPOST_OBSIDIAN_CAPTURE_ENABLED=0 to stop.
# Test hooks (default off): COMPOST_OBSIDIAN_FORCE_POLL=1 skips fswatch;
# COMPOST_OBSIDIAN_MAX_POLLS=N exits 0 after N polling passes.

if [[ "${COMPOST_OBSIDIAN_CAPTURE_ENABLED:-1}" == "0" ]]; then
  exit 0
fi

script_dir="${0:A:h}"
repo_root="${COMPOST_REPO:-${script_dir:h}}"
compost_cli="$repo_root/packages/compost-cli/src/main.ts"
[[ -r "$compost_cli" ]] || exit 1

bun_bin="$(command -v bun 2>/dev/null || true)"
[[ -n "$bun_bin" ]] || bun_bin="$HOME/.bun/bin/bun"
[[ -x "$bun_bin" ]] || bun_bin="/opt/homebrew/bin/bun"
[[ -x "$bun_bin" ]] || exit 1

typeset -a vault_roots
if (( $# > 0 )); then
  vault_roots=("$@")
elif [[ -n "${COMPOST_OBSIDIAN_VAULT_ROOTS:-}" ]]; then
  vault_roots=("${(@s/:/)COMPOST_OBSIDIAN_VAULT_ROOTS}")
else
  echo "compost-obsidian-watch: no vault roots configured" >&2
  exit 2
fi

typeset -a existing_vaults
for vault in "${vault_roots[@]}"; do
  [[ -d "$vault" ]] && existing_vaults+=("${vault:A}")
done
if (( ${#existing_vaults[@]} == 0 )); then
  echo "compost-obsidian-watch: no configured vault roots exist" >&2
  exit 2
fi
vault_roots=("${existing_vaults[@]}")

capture_file() {
  local vault="$1"
  local path="$2"
  local event="${3:-updated}"

  [[ "$path" == *.md ]] || return 0
  [[ "$path" == */.obsidian/* ]] && return 0

  local modified_at size_bytes mtime_epoch
  modified_at="$(/bin/date -u +"%Y-%m-%dT%H:%M:%SZ")"
  size_bytes=""
  if [[ -f "$path" ]]; then
    # stat %Sm formats in local time; convert the epoch so the Z suffix is true UTC.
    mtime_epoch="$(/usr/bin/stat -f "%m" "$path" 2>/dev/null || true)"
    if [[ -n "$mtime_epoch" ]]; then
      modified_at="$(/bin/date -u -r "$mtime_epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || /bin/date -u +"%Y-%m-%dT%H:%M:%SZ")"
    fi
    size_bytes="$(/usr/bin/stat -f "%z" "$path" 2>/dev/null || true)"
  fi

  # Returns the CLI exit status; stderr stays attached so failures reach the log.
  if [[ -n "$size_bytes" ]]; then
    "$bun_bin" "$compost_cli" capture obsidian \
      --vault-root "$vault" \
      --path "$path" \
      --event "$event" \
      --modified-at "$modified_at" \
      --size-bytes "$size_bytes" \
      >/dev/null
  else
    "$bun_bin" "$compost_cli" capture obsidian \
      --vault-root "$vault" \
      --path "$path" \
      --event "$event" \
      --modified-at "$modified_at" \
      >/dev/null
  fi
}

state_key() {
  local key="$1"
  key="${key//\//_}"
  key="${key// /_}"
  key="${key//:/_}"
  key="${key//[^A-Za-z0-9._-]/_}"
  local prefix="${key[1,80]}"
  local digest
  if [[ -x /sbin/md5 ]]; then
    digest="$(print -rn -- "$1" | /sbin/md5 -q)"
  elif [[ -x /usr/bin/shasum ]]; then
    digest="$(print -rn -- "$1" | /usr/bin/shasum | /usr/bin/awk '{print $1}')"
  else
    digest="${key[-80,-1]}"
  fi
  print -r -- "$prefix-$digest"
}

if [[ "${COMPOST_OBSIDIAN_FORCE_POLL:-0}" != "1" ]] && command -v fswatch >/dev/null 2>&1; then
  debounce="${COMPOST_OBSIDIAN_DEBOUNCE_SEC:-2}"
  fswatch -r --latency "$debounce" --exclude '(^|/)\.obsidian($|/)' "$vault_roots[@]" |
    while IFS= read -r path; do
      for vault in "${vault_roots[@]}"; do
        [[ "$path" == "$vault"/* ]] && capture_file "$vault" "$path" "fswatch"
      done
    done
  exit $?
fi

state_dir="${COMPOST_DATA_DIR:-$HOME/.compost}/obsidian-watch-state"
/bin/mkdir -p "$state_dir"
/bin/chmod 700 "$state_dir" 2>/dev/null || true
interval="${COMPOST_OBSIDIAN_POLL_SEC:-5}"
initialized="$state_dir/.initialized"
state_version="hashed-relative-state-v2"
state_version_file="$state_dir/.version"
bootstrap="${COMPOST_OBSIDIAN_BOOTSTRAP_CAPTURE:-0}"
startup_baseline=1
max_polls="${COMPOST_OBSIDIAN_MAX_POLLS:-}"
polls=0

if [[ "$(/bin/cat "$state_version_file" 2>/dev/null || true)" != "$state_version" ]]; then
  /usr/bin/find "$state_dir" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true
  print -r -- "$state_version" > "$state_version_file"
fi

# The signature is persisted only after a successful capture, so a failed
# capture is retried on the next pass. On the startup pass a note with no
# recorded signature is baselined silently; one whose signature differs changed
# while the watcher was down and is captured.
poll_file() {
  local vault="$1"
  local path="$2"
  local key state_file sig old_sig
  key="$(state_key "${path#$vault/}")"
  state_file="$state_dir/$key"
  sig="$(/usr/bin/stat -f "%m:%z" "$path" 2>/dev/null || true)"
  [[ -n "$sig" ]] || return 0
  old_sig="$(/bin/cat "$state_file" 2>/dev/null || true)"
  [[ "$sig" != "$old_sig" ]] || return 0

  if [[ "$startup_baseline" == "1" && "$bootstrap" != "1" && -z "$old_sig" ]]; then
    print -r -- "$sig" > "$state_file"
    return 0
  fi
  if capture_file "$vault" "$path" "poll"; then
    print -r -- "$sig" > "$state_file"
  else
    echo "compost-obsidian-watch: capture failed for $path; will retry" >&2
  fi
}

while true; do
  for vault in "${vault_roots[@]}"; do
    /usr/bin/find "$vault" -type f -name '*.md' -not -path '*/.obsidian/*' -print 2>/dev/null |
      while IFS= read -r path; do
        poll_file "$vault" "$path"
      done
  done
  /usr/bin/touch "$initialized"
  startup_baseline=0
  /bin/sleep "$interval"
  if [[ -n "$max_polls" ]] && (( ++polls >= max_polls )); then
    exit 0
  fi
done
