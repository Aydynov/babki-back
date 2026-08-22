#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/k8s-local-common.sh"

verify_main() {
  require_command kubectl || return 1
  require_command jq || return 1
  require_command curl || return 1
  assert_context || return 1
  verify_stack || return 1
  log 'Verified: http://api.babki.localhost/api/v1'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  verify_main "$@"
fi
