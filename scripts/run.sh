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
log "Starting Roughdraft on http://roughdraft.localhost:${port}"

exec env ROUGHDRAFT_NO_OPEN=1 node "$repo_root/packages/server/bin/roughdraft.mjs"
