#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
source "$PROJECT_ROOT/scripts/deploy-k8s-local.sh"

failures=0

run_test() {
  local name="$1" status
  shift
  set +e
  (set -Eeuo pipefail; "$@")
  status=$?
  set -e
  if [[ "$status" == '0' ]]; then
    printf 'ok - %s\n' "$name"
  else
    printf 'not ok - %s\n' "$name" >&2
    failures=$((failures + 1))
  fi
}

test_runner_rejects_masked_failure() {
  local before_failures="$failures"
  masked_failure() {
    false
    true
  }

  run_test 'masked failure sentinel' masked_failure >/dev/null 2>&1
  [[ "$failures" == "$((before_failures + 1))" ]]
}

test_deploy_main_stops_after_context_rejection_when_called_conditionally() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  require_command() {
    return 0
  }
  assert_context() {
    printf 'assert_context\n' >>"$calls"
    return 1
  }
  assert_cluster_shape() {
    printf 'assert_cluster_shape\n' >>"$calls"
  }
  assert_source_secret() {
    printf 'assert_source_secret\n' >>"$calls"
  }
  install_gateway_fabric() {
    printf 'install_gateway_fabric\n' >>"$calls"
  }
  reconcile_secret() {
    printf 'reconcile_secret\n' >>"$calls"
  }
  apply_application() {
    printf 'apply_application\n' >>"$calls"
  }
  wait_for_stack() {
    printf 'wait_for_stack\n' >>"$calls"
  }
  verify_stack() {
    printf 'verify_stack\n' >>"$calls"
  }
  log() {
    printf 'log\n' >>"$calls"
  }

  if deploy_main; then
    result=1
  fi
  [[ "$(cat "$calls")" == 'assert_context' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_gateway_install_stops_after_first_failed_apply() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$calls"
    [[ "$*" != apply\ --server-side\ -f\ https://github.com/kubernetes-sigs/gateway-api/* ]]
  }

  if install_gateway_fabric >/dev/null 2>&1; then
    result=1
  fi
  [[ "$(wc -l <"$calls" | tr -d ' ')" == '1' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_secret_reconciliation_stops_after_namespace_failure() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$calls"
    if [[ "$*" == 'apply -f -' ]]; then
      cat >/dev/null
      return 0
    fi
    [[ "$*" != 'create namespace babki --dry-run=client -o yaml' ]]
  }
  build_kubernetes_secret_json() {
    printf 'build secret\n' >>"$calls"
  }

  if reconcile_secret >/dev/null 2>&1; then
    result=1
  fi
  if grep -Eq 'babki-gateway|create secret|build secret' "$calls"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_application_apply_stops_after_failed_server_dry_run() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$calls"
    [[ "$*" != "apply --dry-run=server -k $PROJECT_ROOT/k8s/overlays/local" ]]
  }

  if apply_application >/dev/null 2>&1; then
    result=1
  fi
  [[ "$(sed -n '1p' "$calls")" == "apply --dry-run=server -k $PROJECT_ROOT/k8s/overlays/local" ]] || result=1
  [[ "$(wc -l <"$calls" | tr -d ' ')" == '1' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_application_apply_runs_full_order() {
  local directory calls expected result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$calls"
  }

  apply_application >/dev/null 2>&1 || result=1
  expected="$(printf '%s\n' \
    "apply --dry-run=server -k $PROJECT_ROOT/k8s/overlays/local" \
    "apply -f $PROJECT_ROOT/k8s/base/network-policies.yaml" \
    'delete job mongo-bootstrap -n babki --ignore-not-found --wait=true' \
    "apply -k $PROJECT_ROOT/k8s/overlays/local")"
  [[ "$(cat "$calls")" == "$expected" ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_bootstrap_main_only_prepares_cluster_infrastructure() {
  local directory calls expected result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  source "$PROJECT_ROOT/scripts/bootstrap-k8s-local.sh"
  require_command() {
    printf 'require_command %s\n' "$1" >>"$calls"
  }
  assert_context() {
    printf 'assert_context\n' >>"$calls"
  }
  assert_cluster_shape() {
    printf 'assert_cluster_shape\n' >>"$calls"
  }
  install_gateway_fabric() {
    printf 'install_gateway_fabric\n' >>"$calls"
  }

  bootstrap_main >/dev/null 2>&1 || result=1
  expected="$(printf '%s\n' \
    'require_command kubectl' \
    'require_command jq' \
    'assert_context' \
    'assert_cluster_shape' \
    'install_gateway_fabric')"
  [[ "$(cat "$calls")" == "$expected" ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_deploy_main_only_reconciles_application() {
  local directory calls expected result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  require_command() {
    printf 'require_command %s\n' "$1" >>"$calls"
  }
  assert_context() {
    printf 'assert_context\n' >>"$calls"
  }
  assert_local_image() {
    printf 'assert_local_image\n' >>"$calls"
  }
  assert_source_secret() {
    printf 'assert_source_secret %s\n' "$1" >>"$calls"
  }
  reconcile_secret() {
    printf 'reconcile_secret\n' >>"$calls"
  }
  apply_application() {
    printf 'apply_application\n' >>"$calls"
  }
  wait_for_stack() {
    printf 'wait_for_stack\n' >>"$calls"
  }

  deploy_main >/dev/null 2>&1 || result=1
  expected="$(printf '%s\n' \
    'require_command kubectl' \
    'require_command docker' \
    'require_command jq' \
    'assert_context' \
    'assert_local_image' \
    "assert_source_secret $PROJECT_ROOT/config/secrets/docker-compose.local.json" \
    'reconcile_secret' \
    'apply_application' \
    'wait_for_stack')"
  [[ "$(cat "$calls")" == "$expected" ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_verify_main_only_runs_post_deploy_checks() {
  local directory calls expected result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  source "$PROJECT_ROOT/scripts/verify-k8s-local.sh"
  require_command() {
    printf 'require_command %s\n' "$1" >>"$calls"
  }
  assert_context() {
    printf 'assert_context\n' >>"$calls"
  }
  verify_stack() {
    printf 'verify_stack\n' >>"$calls"
  }

  verify_main >/dev/null 2>&1 || result=1
  expected="$(printf '%s\n' \
    'require_command kubectl' \
    'require_command jq' \
    'require_command curl' \
    'assert_context' \
    'verify_stack')"
  [[ "$(cat "$calls")" == "$expected" ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_local_main_runs_all_phases_in_order() {
  local directory calls expected result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  source "$PROJECT_ROOT/scripts/k8s-local.sh"
  run_bootstrap() {
    printf 'bootstrap\n' >>"$calls"
  }
  run_deploy() {
    printf 'deploy\n' >>"$calls"
  }
  run_verify() {
    printf 'verify\n' >>"$calls"
  }

  local_main >/dev/null 2>&1 || result=1
  expected="$(printf '%s\n' bootstrap deploy verify)"
  [[ "$(cat "$calls")" == "$expected" ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_local_main_stops_after_failed_phase() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  source "$PROJECT_ROOT/scripts/k8s-local.sh"
  run_bootstrap() {
    printf 'bootstrap\n' >>"$calls"
  }
  run_deploy() {
    printf 'deploy\n' >>"$calls"
    return 1
  }
  run_verify() {
    printf 'verify\n' >>"$calls"
  }

  if local_main >/dev/null 2>&1; then
    result=1
  fi
  [[ "$(cat "$calls")" == $'bootstrap\ndeploy' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_package_scripts_expose_separate_workflow_phases() {
  local actual expected
  actual="$(node -e '
    const scripts = require("./package.json").scripts;
    for (const name of ["k8s:bootstrap", "k8s:deploy", "k8s:verify", "k8s:local"]) {
      console.log(`${name}=${scripts[name] ?? ""}`);
    }
  ')"
  expected="$(printf '%s\n' \
    'k8s:bootstrap=bash scripts/bootstrap-k8s-local.sh' \
    'k8s:deploy=bash scripts/deploy-k8s-local.sh' \
    'k8s:verify=bash scripts/verify-k8s-local.sh' \
    'k8s:local=bash scripts/k8s-local.sh')"
  [[ "$actual" == "$expected" ]]
}

test_cluster_calls_remain_pinned_after_current_context_changes() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  MOCK_CURRENT_CONTEXT='docker-desktop'
  kubectl() {
    if [[ "$*" == 'config current-context' ]]; then
      printf '%s\n' "$MOCK_CURRENT_CONTEXT"
      return 0
    fi
    printf '%s\n' "$*" >>"$calls"
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]]
  }

  assert_context >/dev/null 2>&1 || result=1
  MOCK_CURRENT_CONTEXT='production'
  apply_application >/dev/null 2>&1 || result=1
  [[ "$(wc -l <"$calls" | tr -d ' ')" == '4' ]] || result=1
  if grep -Evq '^--context docker-desktop ' "$calls"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_stack_wait_stops_after_failed_mongo_rollout() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$calls"
    [[ "$*" != 'rollout status statefulset/mongo -n babki --timeout=5m' ]]
  }
  wait_for_httproute() {
    printf 'wait_for_httproute\n' >>"$calls"
  }

  if wait_for_stack >/dev/null 2>&1; then
    result=1
  fi
  [[ "$(cat "$calls")" == 'rollout status statefulset/mongo -n babki --timeout=5m' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_cluster_shape_propagates_node_query_failure() {
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    case "$*" in
      'get nodes -o json') return 1 ;;
      'get storageclass standard') return 0 ;;
      'get node desktop-control-plane -o json') printf '{}\n' ;;
      *) return 1 ;;
    esac
  }
  jq() {
    case "$*" in
      *length*) printf '3\n' ;;
      *) return 0 ;;
    esac
  }
  docker() {
    return 0
  }

  ! assert_cluster_shape >/dev/null 2>&1
}

mock_valid_cluster_shape_dependencies() {
  : "${CLUSTER_STORAGE_PROVISIONER:=rancher.io/local-path}"
  : "${CLUSTER_KINDNET_DESIRED:=3}"
  : "${CLUSTER_KINDNET_READY:=3}"
  : "${CLUSTER_KINDNET_AVAILABLE:=3}"
  if [[ -z "${CLUSTER_NODES_JSON+x}" ]]; then
    CLUSTER_NODES_JSON='{
      "items": [
        {
          "metadata": {
            "name": "desktop-control-plane",
            "labels": {"node-role.kubernetes.io/control-plane": ""}
          },
          "spec": {
            "unschedulable": false,
            "taints": [{"key": "node-role.kubernetes.io/control-plane", "effect": "NoSchedule"}]
          },
          "status": {"conditions": [{"type": "Ready", "status": "True"}]}
        },
        {
          "metadata": {"name": "desktop-worker", "labels": {}},
          "spec": {"unschedulable": false},
          "status": {"conditions": [{"type": "Ready", "status": "True"}]}
        },
        {
          "metadata": {"name": "desktop-worker2", "labels": {}},
          "spec": {"unschedulable": false},
          "status": {"conditions": [{"type": "Ready", "status": "True"}]}
        }
      ]
    }'
  fi

  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    case "$*" in
      'get nodes -o json') printf '%s\n' "$CLUSTER_NODES_JSON" ;;
      'get storageclass standard' | 'get storageclass standard -o json')
        printf '{"provisioner":"%s"}\n' "$CLUSTER_STORAGE_PROVISIONER"
        ;;
      'get node desktop-control-plane -o json')
        printf '%s\n' "$CLUSTER_NODES_JSON" | command jq '.items[0]'
        ;;
      'get daemonset kindnet -n kube-system -o json')
        printf '{"status":{"desiredNumberScheduled":%s,"numberReady":%s,"numberAvailable":%s}}\n' \
          "$CLUSTER_KINDNET_DESIRED" "$CLUSTER_KINDNET_READY" "$CLUSTER_KINDNET_AVAILABLE"
        ;;
      *) return 1 ;;
    esac
  }
  docker() {
    return 0
  }
}

test_cluster_shape_rejects_wrong_storage_provisioner() {
  CLUSTER_STORAGE_PROVISIONER='example.com/not-local-path'
  mock_valid_cluster_shape_dependencies

  ! assert_cluster_shape >/dev/null 2>&1
}

test_cluster_shape_rejects_unready_kindnet() {
  CLUSTER_KINDNET_READY=2
  mock_valid_cluster_shape_dependencies

  ! assert_cluster_shape >/dev/null 2>&1
}

test_cluster_shape_rejects_unexpected_control_plane_role() {
  mock_valid_cluster_shape_dependencies
  CLUSTER_NODES_JSON="$(command jq \
    '.items[1].metadata.labels["node-role.kubernetes.io/control-plane"] = ""' \
    <<<"$CLUSTER_NODES_JSON")"

  ! assert_cluster_shape >/dev/null 2>&1
}

test_cluster_shape_rejects_unschedulable_node() {
  mock_valid_cluster_shape_dependencies
  CLUSTER_NODES_JSON="$(command jq '.items[2].spec.unschedulable = true' \
    <<<"$CLUSTER_NODES_JSON")"

  ! assert_cluster_shape >/dev/null 2>&1
}

test_stack_verification_stops_after_failed_first_query() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  VERIFY_FIRST_FAILURE=true
  mock_healthy_stack_dependencies

  if verify_stack >/dev/null 2>&1; then
    result=1
  fi
  if grep -q '^create:namespace$' "$TEST_KUBECTL_LOG"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_reconcile_secret_cleanup_is_scoped() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_RECONCILE_TEMP="$directory/reconcile-secret"
  mkdir "$TEST_RECONCILE_TEMP"
  mktemp() {
    [[ "$*" == '-d' ]] || return 1
    printf '%s\n' "$TEST_RECONCILE_TEMP"
  }
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    if [[ "$*" == *'-f -'* ]]; then
      cat >/dev/null
    fi
  }
  build_kubernetes_secret_json() {
    printf '{}\n' >"$2"
  }
  reconcile_from_wrapper() {
    reconcile_secret >/dev/null || return 1
    [[ -z "$(trap -p RETURN)" ]] || return 1
    [[ ! -e "$TEST_RECONCILE_TEMP" ]]
  }

  reconcile_from_wrapper || result=1
  rm -rf "$directory"
  return "$result"
}

mock_healthy_stack_dependencies() {
  : "${TEST_KUBECTL_LOG:=/dev/null}"
  : "${TEST_CURL_LOG:=/dev/null}"
  : "${PROBE_WAIT_FAILURE:=false}"
  : "${PROBE_DNS_FAILURE:=false}"
  : "${PROBE_EXEC_FAILURE:=false}"
  : "${PROBE_MONGO_CREATE_FAILURE:=false}"
  : "${PROBE_POLICY_COUNT:=0}"
  : "${MONGO_DNS_FAILURE:=false}"
  : "${PROBE_NAMESPACE_RESOURCE:=namespace/babki-network-probe-generated}"
  : "${PROBE_CLEANUP_FAILURE:=false}"
  : "${VERIFY_FIRST_FAILURE:=false}"
  : "${API_PROBE_STATUS:=28}"
  : "${MONGO_PROBE_RESULT:=$(printf 'status:1\nMongoServerSelectionError: Server selection timed out after 3000 ms')}"
  if [[ -z "${REPLICA_STATUS+x}" ]]; then
    REPLICA_STATUS='[
      {"name":"mongo-0.mongo.babki.svc.cluster.local:27017","stateStr":"PRIMARY","health":1},
      {"name":"mongo-1.mongo.babki.svc.cluster.local:27017","stateStr":"SECONDARY","health":1},
      {"name":"mongo-2.mongo.babki.svc.cluster.local:27017","stateStr":"SECONDARY","health":1}
    ]'
  fi

  jq() {
    case "$*" in
      *'unique | length'*) cat >/dev/null; printf '3\n' ;;
      *'startswith("data-mongo-")'*) cat >/dev/null; printf '3\n' ;;
      *'mongo-0.mongo.babki.svc.cluster.local:27017'*) command jq "$@" ;;
      *'stateStr == "PRIMARY"'*) printf '1\n' ;;
      *'stateStr == "SECONDARY"'*) printf '2\n' ;;
      *'all(.items[]; .spec.type == "ClusterIP")'*) cat >/dev/null; return 0 ;;
      *'select(.spec.type == "LoadBalancer")'*) cat >/dev/null; printf '1\n' ;;
      '.items | length') cat >/dev/null; printf '%s\n' "$PROBE_POLICY_COUNT" ;;
      *) return 1 ;;
    esac
  }
  curl() {
    printf '%s\n' "$*" >>"$TEST_CURL_LOG"
    return 0
  }
  kubectl() {
    local manifest
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$TEST_KUBECTL_LOG"
    case "$*" in
      'get pods -n babki -l app.kubernetes.io/name=mongo -o json')
        [[ "$VERIFY_FIRST_FAILURE" != 'true' ]] || return 1
        printf '{}\n'
        ;;
      'get pvc -n babki -o json') printf '{}\n' ;;
      'exec -n babki mongo-0 -- mongosh'*) printf '%s\n' "$REPLICA_STATUS" ;;
      'get deployment babki-api -n babki -o jsonpath={.status.readyReplicas}') printf '2\n' ;;
      'get services -n babki -o json') printf '{}\n' ;;
      'get services -n babki-gateway -o json') printf '{}\n' ;;
      'get networkpolicy -n babki-network-probe-generated -o json') printf '{}\n' ;;
      'create -f - -o name')
        manifest="$(cat)"
        if [[ "$manifest" == *'generateName: babki-network-probe-'* ]]; then
          printf 'create:namespace\n' >>"$TEST_KUBECTL_LOG"
          printf '%s\n' "$PROBE_NAMESPACE_RESOURCE"
        elif [[ "$manifest" == *'generateName: babki-deny-api-'* ]]; then
          printf 'create:api\n' >>"$TEST_KUBECTL_LOG"
          [[ "$manifest" == *'namespace: babki-network-probe-generated'* ]] && \
            printf 'namespace:api-owned\n' >>"$TEST_KUBECTL_LOG"
          printf 'pod/babki-deny-api-generated\n'
        elif [[ "$manifest" == *'generateName: babki-deny-mongo-'* ]]; then
          printf 'create:mongo\n' >>"$TEST_KUBECTL_LOG"
          [[ "$manifest" == *'namespace: babki-network-probe-generated'* ]] && \
            printf 'namespace:mongo-owned\n' >>"$TEST_KUBECTL_LOG"
          [[ "$PROBE_MONGO_CREATE_FAILURE" != 'true' ]] || return 1
          printf 'pod/babki-deny-mongo-generated\n'
        else
          return 1
        fi
        ;;
      'wait namespace/babki-network-probe-generated '*) return 0 ;;
      'wait pod/'*) [[ "$PROBE_WAIT_FAILURE" != 'true' ]] ;;
      'exec -n babki-network-probe-generated babki-deny-api-generated -- nslookup '*)
        [[ "$PROBE_DNS_FAILURE" != 'true' ]]
        ;;
      'exec -n babki-network-probe-generated babki-deny-api-generated -- sh -c '*)
        [[ "$PROBE_EXEC_FAILURE" != 'true' ]] || return 1
        printf '%s\n' "$API_PROBE_STATUS"
        ;;
      'exec -n babki-network-probe-generated babki-deny-mongo-generated -- getent hosts '*)
        [[ "$MONGO_DNS_FAILURE" != 'true' ]]
        ;;
      'exec -n babki-network-probe-generated babki-deny-mongo-generated -- mongosh --version') return 0 ;;
      'exec -n babki-network-probe-generated babki-deny-mongo-generated -- sh -c '*)
        [[ "$PROBE_EXEC_FAILURE" != 'true' ]] || return 1
        printf '%s\n' "$MONGO_PROBE_RESULT"
        ;;
      'delete namespace babki-network-probe-generated '*)
        [[ "$PROBE_CLEANUP_FAILURE" != 'true' ]]
        ;;
      'get namespace babki-network-probe-generated --ignore-not-found -o name '*) return 0 ;;
      *) return 1 ;;
    esac
  }
}

test_verify_stack_cleanup_is_scoped() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  mock_healthy_stack_dependencies
  verify_from_wrapper() {
    verify_stack >/dev/null 2>&1 || return 1
    [[ -z "$(trap -p RETURN)" ]] || return 1
    grep -q '^delete namespace babki-network-probe-generated --ignore-not-found --wait=false$' \
      "$TEST_KUBECTL_LOG"
  }

  verify_from_wrapper || result=1
  rm -rf "$directory"
  return "$result"
}

test_unready_probe_pod_is_rejected() {
  PROBE_WAIT_FAILURE=true
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_probe_dns_failure_is_rejected() {
  PROBE_DNS_FAILURE=true
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_probe_exec_infrastructure_failure_is_rejected() {
  PROBE_EXEC_FAILURE=true
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_probe_pods_use_server_generated_names() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  mock_healthy_stack_dependencies

  verify_stack >/dev/null 2>&1 || result=1
  [[ "$(grep -c '^create:namespace$' "$TEST_KUBECTL_LOG")" == '1' ]] || result=1
  [[ "$(grep -c '^create:api$' "$TEST_KUBECTL_LOG")" == '1' ]] || result=1
  [[ "$(grep -c '^create:mongo$' "$TEST_KUBECTL_LOG")" == '1' ]] || result=1
  [[ "$(grep -c '^namespace:api-owned$' "$TEST_KUBECTL_LOG")" == '1' ]] || result=1
  [[ "$(grep -c '^namespace:mongo-owned$' "$TEST_KUBECTL_LOG")" == '1' ]] || result=1
  if grep -Eq '^delete pod babki-deny-(api|mongo)-[0-9]+' "$TEST_KUBECTL_LOG"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_failed_probe_creation_cleans_only_created_namespace() {
  local directory delete_commands result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  PROBE_MONGO_CREATE_FAILURE=true
  mock_healthy_stack_dependencies

  if verify_stack >/dev/null 2>&1; then
    result=1
  fi
  delete_commands="$(grep -E '^delete (pod|namespace) ' "$TEST_KUBECTL_LOG" || true)"
  [[ "$delete_commands" == 'delete namespace babki-network-probe-generated --ignore-not-found --wait=false' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

test_source_namespace_with_policy_is_rejected() {
  PROBE_POLICY_COUNT=1
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_foreign_namespace_name_is_not_deleted() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  PROBE_NAMESPACE_RESOURCE='namespace/default'
  mock_healthy_stack_dependencies

  if verify_stack >/dev/null 2>&1; then
    result=1
  fi
  if grep -q '^delete namespace default ' "$TEST_KUBECTL_LOG"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_successful_verification_requires_namespace_cleanup() {
  PROBE_CLEANUP_FAILURE=true
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_accepted_probe_namespace_deletion_must_reach_not_found() {
  local directory calls result=0
  directory="$(mktemp -d)"
  calls="$directory/calls"
  PROBE_CLEANUP_TIMEOUT_SECONDS=4
  PROBE_CLEANUP_REQUEST_TIMEOUT_SECONDS=1
  PROBE_CLEANUP_POLL_INTERVAL_SECONDS=2
  SECONDS=0
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$calls"
    case "$*" in
      'delete namespace babki-network-probe-stuck --ignore-not-found --wait=false') return 0 ;;
      'get namespace babki-network-probe-stuck --ignore-not-found -o name --request-timeout=1s')
        printf 'namespace/babki-network-probe-stuck\n'
        ;;
      *) return 1 ;;
    esac
  }
  sleep() {
    SECONDS=$((SECONDS + 2))
  }

  if cleanup_network_probe_namespace 'babki-network-probe-stuck' >/dev/null 2>&1; then
    result=1
  fi
  grep -q '^delete namespace babki-network-probe-stuck ' "$calls" || result=1
  rm -rf "$directory"
  return "$result"
}

test_mongo_probe_dns_failure_is_rejected() {
  MONGO_DNS_FAILURE=true
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_mongo_runtime_error_is_not_policy_denial() {
  MONGO_PROBE_RESULT="$(printf 'status:1\nSyntaxError: client initialization failed')"
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_mongo_probe_sets_timeout_in_uri() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  mock_healthy_stack_dependencies

  verify_stack >/dev/null 2>&1 || result=1
  grep -Fq \
    'mongodb://mongo.babki.svc.cluster.local:27017/admin?serverSelectionTimeoutMS=3000' \
    "$TEST_KUBECTL_LOG" || result=1
  if grep -q -- '--serverSelectionTimeoutMS' "$TEST_KUBECTL_LOG"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_direct_api_connection_is_rejected() {
  API_PROBE_STATUS=0
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_direct_mongo_connection_is_rejected() {
  MONGO_PROBE_RESULT='status:0'
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_extra_replica_member_is_rejected() {
  REPLICA_STATUS='[
    {"name":"mongo-0.mongo.babki.svc.cluster.local:27017","stateStr":"PRIMARY","health":1},
    {"name":"mongo-1.mongo.babki.svc.cluster.local:27017","stateStr":"SECONDARY","health":1},
    {"name":"mongo-2.mongo.babki.svc.cluster.local:27017","stateStr":"SECONDARY","health":1},
    {"name":"mongo-foreign.example:27017","stateStr":"UNKNOWN","health":0}
  ]'
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_wrong_replica_member_is_rejected() {
  REPLICA_STATUS='[
    {"name":"mongo-0.mongo.babki.svc.cluster.local:27017","stateStr":"PRIMARY","health":1},
    {"name":"mongo-1.mongo.babki.svc.cluster.local:27017","stateStr":"SECONDARY","health":1},
    {"name":"mongo-wrong.mongo.babki.svc.cluster.local:27017","stateStr":"SECONDARY","health":1}
  ]'
  mock_healthy_stack_dependencies

  ! verify_stack >/dev/null 2>&1
}

test_http_probes_have_total_timeouts() {
  local directory result=0
  directory="$(mktemp -d)"
  TEST_KUBECTL_LOG="$directory/kubectl.log"
  TEST_CURL_LOG="$directory/curl.log"
  mock_healthy_stack_dependencies

  verify_stack >/dev/null 2>&1 || result=1
  grep -Eq -- '--max-time [0-9]+' "$TEST_CURL_LOG" || result=1
  grep -Eq -- 'curl .*--max-time [0-9]+' "$TEST_KUBECTL_LOG" || result=1
  rm -rf "$directory"
  return "$result"
}

test_wait_for_stack_uses_parent_route_condition() {
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    case "$*" in
      'rollout status statefulset/mongo -n babki --timeout=5m') return 0 ;;
      'wait job/mongo-bootstrap -n babki --for=condition=Complete --timeout=5m') return 0 ;;
      'rollout status deployment/babki-api -n babki --timeout=5m') return 0 ;;
      'wait gateway/babki -n babki-gateway --for=condition=Programmed --timeout=5m') return 0 ;;
      'wait httproute/'*) return 1 ;;
      'get httproute babki-api -n babki -o json'*)
        printf '%s\n' '{
          "metadata":{"generation":3},
          "status":{"parents":[{
            "parentRef":{"name":"babki","namespace":"babki-gateway","sectionName":"http"},
            "controllerName":"gateway.nginx.org/nginx-gateway-controller",
            "conditions":[{"type":"Accepted","status":"True","observedGeneration":3}]
          }]}
        }'
        ;;
      *) return 1 ;;
    esac
  }
  sleep() {
    return 0
  }

  wait_for_stack >/dev/null
}

test_wait_for_stack_rejects_stale_route_condition() {
  HTTPROUTE_WAIT_TIMEOUT_SECONDS=10
  SECONDS=0
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    case "$*" in
      'rollout status statefulset/mongo -n babki --timeout=5m') return 0 ;;
      'wait job/mongo-bootstrap -n babki --for=condition=Complete --timeout=5m') return 0 ;;
      'rollout status deployment/babki-api -n babki --timeout=5m') return 0 ;;
      'wait gateway/babki -n babki-gateway --for=condition=Programmed --timeout=5m') return 0 ;;
      'wait httproute/'*) return 0 ;;
      'get httproute babki-api -n babki -o json'*)
        printf '%s\n' '{
          "metadata":{"generation":4},
          "status":{"parents":[{
            "parentRef":{"name":"babki","namespace":"babki-gateway","sectionName":"http"},
            "controllerName":"gateway.nginx.org/nginx-gateway-controller",
            "conditions":[{"type":"Accepted","status":"True","observedGeneration":3}]
          }]}
        }'
        ;;
      *) return 1 ;;
    esac
  }
  sleep() {
    SECONDS=$((SECONDS + 5))
    return 0
  }

  ! wait_for_stack >/dev/null 2>&1
}

test_wait_for_stack_retries_transient_route_get() {
  local directory route_get_log
  directory="$(mktemp -d)"
  route_get_log="$directory/route-get.log"
  HTTPROUTE_WAIT_TIMEOUT_SECONDS=10
  SECONDS=0
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    case "$*" in
      'rollout status statefulset/mongo -n babki --timeout=5m') return 0 ;;
      'wait job/mongo-bootstrap -n babki --for=condition=Complete --timeout=5m') return 0 ;;
      'rollout status deployment/babki-api -n babki --timeout=5m') return 0 ;;
      'wait gateway/babki -n babki-gateway --for=condition=Programmed --timeout=5m') return 0 ;;
      'get httproute babki-api -n babki -o json'*)
        printf 'get\n' >>"$route_get_log"
        if [[ "$(wc -l <"$route_get_log" | tr -d ' ')" == '1' ]]; then
          return 1
        fi
        printf '%s\n' '{
          "metadata":{"generation":3},
          "status":{"parents":[{
            "parentRef":{"name":"babki","namespace":"babki-gateway","sectionName":"http"},
            "controllerName":"gateway.nginx.org/nginx-gateway-controller",
            "conditions":[{"type":"Accepted","status":"True","observedGeneration":3}]
          }]}
        }'
        ;;
      *) return 1 ;;
    esac
  }
  sleep() {
    SECONDS=$((SECONDS + 5))
  }

  wait_for_stack >/dev/null || {
    rm -rf "$directory"
    return 1
  }
  [[ "$(wc -l <"$route_get_log" | tr -d ' ')" == '2' ]]
  local status=$?
  rm -rf "$directory"
  return "$status"
}

test_httproute_polling_has_deadline_and_request_timeout() {
  local directory route_get_log result=0
  directory="$(mktemp -d)"
  route_get_log="$directory/route-get.log"
  HTTPROUTE_WAIT_TIMEOUT_SECONDS=10
  HTTPROUTE_REQUEST_TIMEOUT_SECONDS=2
  SECONDS=0
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' "$*" >>"$route_get_log"
    return 1
  }
  sleep() {
    SECONDS=$((SECONDS + 5))
  }

  if wait_for_httproute >/dev/null 2>&1; then
    result=1
  fi
  [[ "$(wc -l <"$route_get_log" | tr -d ' ')" == '2' ]] || result=1
  if grep -Evq -- '--request-timeout=2s$' "$route_get_log"; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_httproute_rejects_different_listener_section() {
  HTTPROUTE_WAIT_TIMEOUT_SECONDS=10
  SECONDS=0
  kubectl() {
    [[ "${1:-}" == '--context' && "${2:-}" == 'docker-desktop' ]] || return 99
    shift 2
    printf '%s\n' '{
      "metadata":{"generation":3},
      "status":{"parents":[{
        "parentRef":{"name":"babki","namespace":"babki-gateway","sectionName":"metrics"},
        "controllerName":"gateway.nginx.org/nginx-gateway-controller",
        "conditions":[{"type":"Accepted","status":"True","observedGeneration":3}]
      }]}
    }'
  }
  sleep() {
    SECONDS=$((SECONDS + 5))
  }

  ! wait_for_httproute >/dev/null 2>&1
}

test_wrong_context_is_rejected() {
  kubectl() {
    [[ "$*" == 'config current-context' ]] && printf 'production\n'
  }
  ! assert_context >/dev/null 2>&1
}

test_exact_context_is_accepted() {
  kubectl() {
    [[ "$*" == 'config current-context' ]] && printf 'docker-desktop\n'
  }
  assert_context >/dev/null
}

test_missing_secret_key_is_rejected() {
  local directory secret result=0
  directory="$(mktemp -d)"
  secret="$directory/source.json"
  printf '{"JWT_SECRET":"dummy"}\n' >"$secret"
  if assert_source_secret "$secret" >/dev/null 2>&1; then
    result=1
  fi
  rm -rf "$directory"
  return "$result"
}

test_secret_merge_is_silent_and_preserves_keys() {
  local directory source_file output_file uri command_output result=0
  directory="$(mktemp -d)"
  source_file="$directory/source.json"
  output_file="$directory/output.json"
  printf '%s\n' '{
    "JWT_SECRET":"jwt-value-that-must-not-be-printed",
    "TOTP_ENCRYPTION_ACTIVE_KEY_ID":"enc-v1",
    "TOTP_ENCRYPTION_KEYS":{"enc-v1":"key-a"},
    "RECOVERY_HMAC_ACTIVE_KEY_ID":"recovery-v1",
    "RECOVERY_HMAC_KEYS":{"recovery-v1":"key-b"},
    "AUTH_THROTTLE_HMAC_KEY":"key-c"
  }' >"$source_file"
  uri='mongodb://mongo-0,mongo-1,mongo-2/babki_db?replicaSet=rs0'
  command_output="$(build_kubernetes_secret_json "$source_file" "$output_file" "$uri")" || result=1
  [[ -z "$command_output" ]] || result=1
  [[ "$(jq -r '.MONGO_URI' "$output_file")" == "$uri" ]] || result=1
  [[ "$(jq -r '.JWT_SECRET' "$output_file")" == 'jwt-value-that-must-not-be-printed' ]] || result=1
  [[ "$(stat -f '%Lp' "$output_file")" == '600' ]] || result=1
  rm -rf "$directory"
  return "$result"
}

run_test 'wrong context is rejected' test_wrong_context_is_rejected
run_test 'runner rejects an early masked failure' test_runner_rejects_masked_failure
run_test 'conditional deploy main stops after context rejection' test_deploy_main_stops_after_context_rejection_when_called_conditionally
run_test 'bootstrap main only prepares cluster infrastructure' test_bootstrap_main_only_prepares_cluster_infrastructure
run_test 'deploy main only reconciles the application' test_deploy_main_only_reconciles_application
run_test 'verify main only runs post-deploy checks' test_verify_main_only_runs_post_deploy_checks
run_test 'local main runs all phases in order' test_local_main_runs_all_phases_in_order
run_test 'local main stops after a failed phase' test_local_main_stops_after_failed_phase
run_test 'package scripts expose separate workflow phases' test_package_scripts_expose_separate_workflow_phases
run_test 'gateway install stops after first failed apply' test_gateway_install_stops_after_first_failed_apply
run_test 'secret reconciliation stops after namespace failure' test_secret_reconciliation_stops_after_namespace_failure
run_test 'application apply stops after failed server dry-run' test_application_apply_stops_after_failed_server_dry_run
run_test 'application apply runs server dry-run, delete, and apply in order' test_application_apply_runs_full_order
run_test 'cluster calls remain pinned after current context changes' test_cluster_calls_remain_pinned_after_current_context_changes
run_test 'stack wait stops after failed Mongo rollout' test_stack_wait_stops_after_failed_mongo_rollout
run_test 'cluster shape propagates node query failure' test_cluster_shape_propagates_node_query_failure
run_test 'cluster shape rejects wrong storage provisioner' test_cluster_shape_rejects_wrong_storage_provisioner
run_test 'cluster shape rejects unready kindnet' test_cluster_shape_rejects_unready_kindnet
run_test 'cluster shape rejects unexpected control-plane role' test_cluster_shape_rejects_unexpected_control_plane_role
run_test 'cluster shape rejects unschedulable node' test_cluster_shape_rejects_unschedulable_node
run_test 'stack verification stops after failed first query' test_stack_verification_stops_after_failed_first_query
run_test 'docker-desktop context is accepted' test_exact_context_is_accepted
run_test 'missing secret key is rejected' test_missing_secret_key_is_rejected
run_test 'secret merge is silent and preserves keys' test_secret_merge_is_silent_and_preserves_keys
run_test 'secret cleanup is scoped to reconciliation' test_reconcile_secret_cleanup_is_scoped
run_test 'network probe cleanup is scoped to verification' test_verify_stack_cleanup_is_scoped
run_test 'unready probe pod is rejected' test_unready_probe_pod_is_rejected
run_test 'probe DNS failure is rejected' test_probe_dns_failure_is_rejected
run_test 'probe exec infrastructure failure is rejected' test_probe_exec_infrastructure_failure_is_rejected
run_test 'probe pods use server-generated names' test_probe_pods_use_server_generated_names
run_test 'partial probe creation cleans only the created namespace' test_failed_probe_creation_cleans_only_created_namespace
run_test 'source namespace with a policy is rejected' test_source_namespace_with_policy_is_rejected
run_test 'foreign namespace name is never deleted' test_foreign_namespace_name_is_not_deleted
run_test 'successful verification requires namespace cleanup' test_successful_verification_requires_namespace_cleanup
run_test 'accepted probe namespace deletion must reach NotFound' test_accepted_probe_namespace_deletion_must_reach_not_found
run_test 'MongoDB probe DNS failure is rejected' test_mongo_probe_dns_failure_is_rejected
run_test 'MongoDB runtime error is not policy denial' test_mongo_runtime_error_is_not_policy_denial
run_test 'MongoDB probe timeout is set in the URI' test_mongo_probe_sets_timeout_in_uri
run_test 'direct API connectivity is rejected' test_direct_api_connection_is_rejected
run_test 'direct MongoDB connectivity is rejected' test_direct_mongo_connection_is_rejected
run_test 'extra replica-set member is rejected' test_extra_replica_member_is_rejected
run_test 'wrong replica-set member is rejected' test_wrong_replica_member_is_rejected
run_test 'HTTP probes have total timeouts' test_http_probes_have_total_timeouts
run_test 'stack wait uses parent HTTPRoute condition' test_wait_for_stack_uses_parent_route_condition
run_test 'stack wait rejects stale HTTPRoute condition' test_wait_for_stack_rejects_stale_route_condition
run_test 'stack wait retries transient HTTPRoute get' test_wait_for_stack_retries_transient_route_get
run_test 'HTTPRoute polling has deadline and request timeout' test_httproute_polling_has_deadline_and_request_timeout
run_test 'HTTPRoute rejects a different listener section' test_httproute_rejects_different_listener_section

exit "$failures"
