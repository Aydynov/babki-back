#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/k8s-local-common.sh"

bootstrap_main() {
  require_command kubectl || return 1
  require_command jq || return 1
  assert_context || return 1
  assert_cluster_shape || return 1
  install_gateway_fabric || return 1
  log 'Cluster infrastructure is ready.'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  bootstrap_main "$@"
fi
