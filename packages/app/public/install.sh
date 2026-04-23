#!/usr/bin/env bash

set -euo pipefail

PACKAGE_SPEC="${ROUGHDRAFT_PACKAGE_SPEC:-roughdraft@latest}"

log() {
  printf '[roughdraft-install] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'roughdraft install error: missing required command `%s`\n' "$1" >&2
    exit 1
  fi
}

require_command node
require_command npx

log "Running npx --yes ${PACKAGE_SPEC} install"
exec npx --yes "$PACKAGE_SPEC" install
