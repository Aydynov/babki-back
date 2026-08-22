#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/k8s-local-common.sh"

deploy_main() {
  require_command kubectl || return 1
  require_command docker || return 1
  require_command jq || return 1
  assert_context || return 1
  assert_local_image || return 1
  assert_source_secret "$SOURCE_SECRET" || return 1
  reconcile_secret || return 1
  apply_application || return 1
  wait_for_stack || return 1
  log 'Deployed: http://api.babki.localhost/api/v1'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  deploy_main "$@"
fi
