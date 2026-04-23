#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_tooling
cd "$repo_root"

waited_for_other_setup=0

while ! mkdir "$setup_lock_dir" 2>/dev/null; do
  if [[ "$waited_for_other_setup" -eq 0 ]]; then
    log "Another setup process is already running."
    waited_for_other_setup=1
  fi

  sleep 1
done

cleanup() {
  rm -rf "$setup_lock_dir"
}

trap cleanup EXIT

if [[ "$waited_for_other_setup" -eq 1 ]] && setup_ready; then
  log "Setup completed by the other process."
  exit 0
fi

rm -f "$setup_stamp"

log "Installing dependencies..."
pnpm install --frozen-lockfile

log "Building workspace packages..."
pnpm build

touch "$setup_stamp"
log "Setup complete."
