#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

run_bootstrap() {
  bash "$SCRIPT_DIR/bootstrap-k8s-local.sh"
}

run_deploy() {
  bash "$SCRIPT_DIR/deploy-k8s-local.sh"
}

run_verify() {
  bash "$SCRIPT_DIR/verify-k8s-local.sh"
}

local_main() {
  run_bootstrap || return 1
  run_deploy || return 1
  run_verify || return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  local_main "$@"
fi
