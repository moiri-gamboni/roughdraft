#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_tooling
cd "$repo_root"

wait_for_setup_lock

if ! setup_ready; then
  log "Build artifacts are missing. Running setup first..."
  "$repo_root/scripts/setup.sh"
fi

port="${PORT:-3000}"
project_dir="${PROJECT_DIR:-$repo_root/sandbox}"
log "Starting Roughdraft on http://localhost:${port}"

exec node "$repo_root/packages/server/dist/child.js" --port "$port" --project-dir "$project_dir"
