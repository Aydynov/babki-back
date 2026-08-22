#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
MANIFEST_DIR="$PROJECT_ROOT/k8s"
BASE_DIR="$MANIFEST_DIR/base"
LOCAL_OVERLAY_DIR="$MANIFEST_DIR/overlays/local"
SOURCE_SECRET="$PROJECT_ROOT/config/secrets/docker-compose.local.json"
API_IMAGE='babki-back-api:latest'
EXPECTED_CONTEXT='docker-desktop'
APP_NAMESPACE='babki'
GATEWAY_NAMESPACE='babki-gateway'
GATEWAY_API_VERSION='1.5.1'
NGF_VERSION='2.6.7'
GATEWAY_CONTROLLER_NAME='gateway.nginx.org/nginx-gateway-controller'
HTTPROUTE_WAIT_TIMEOUT_SECONDS=300
HTTPROUTE_REQUEST_TIMEOUT_SECONDS=10
HTTPROUTE_POLL_INTERVAL_SECONDS=5
PROBE_CLEANUP_TIMEOUT_SECONDS=60
PROBE_CLEANUP_REQUEST_TIMEOUT_SECONDS=5
PROBE_CLEANUP_POLL_INTERVAL_SECONDS=2
MONGO_URI='mongodb://mongo-0.mongo.babki.svc.cluster.local:27017,mongo-1.mongo.babki.svc.cluster.local:27017,mongo-2.mongo.babki.svc.cluster.local:27017/babki_db?replicaSet=rs0'

log() {
  printf '[k8s-local] %s\n' "$*"
}

die() {
  printf '[k8s-local] ERROR: %s\n' "$*" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

kube() {
  kubectl --context "$EXPECTED_CONTEXT" "$@"
}

assert_context() {
  local context
  context="$(kubectl config current-context)" || return 1
  if [[ "$context" != "$EXPECTED_CONTEXT" ]]; then
    die "Refusing context '$context'; expected '$EXPECTED_CONTEXT'."
    return 1
  fi
}

assert_cluster_shape() {
  local node_count ready_count
  node_count="$(kube get nodes -o json | jq '.items | length')" || return 1
  ready_count="$(kube get nodes -o json | jq '[
    .items[] |
    select(.status.conditions | any(.type == "Ready" and .status == "True"))
  ] | length')" || return 1
  if [[ "$node_count" != '3' || "$ready_count" != '3' ]]; then
    die "Expected exactly three Ready nodes; found $ready_count/$node_count."
    return 1
  fi

  if ! kube get storageclass standard -o json | jq -e '
    .provisioner == "rancher.io/local-path"
  ' >/dev/null; then
    die "StorageClass 'standard' must use rancher.io/local-path."
    return 1
  fi
  if ! kube get daemonset kindnet -n kube-system -o json | jq -e \
    --argjson expected_nodes "$node_count" '
      .status.desiredNumberScheduled == $expected_nodes and
      .status.numberReady == $expected_nodes and
      .status.numberAvailable == $expected_nodes
    ' >/dev/null; then
    die 'kindnet must be Ready and available on all three nodes.'
    return 1
  fi
  if ! kube get nodes -o json | jq -e '
    ([.items[].metadata.name] | sort) == [
      "desktop-control-plane",
      "desktop-worker",
      "desktop-worker2"
    ] and
    ([
      .items[] |
      select(.metadata.labels | has("node-role.kubernetes.io/control-plane")) |
      .metadata.name
    ] | sort) == ["desktop-control-plane"] and
    all(.items[]; (.spec.unschedulable // false) == false)
  ' >/dev/null; then
    die 'Expected one control-plane, two worker nodes, and all nodes schedulable.'
    return 1
  fi
  if ! kube get node desktop-control-plane -o json | jq -e '
    (.spec.taints // []) |
    any(.key == "node-role.kubernetes.io/control-plane" and .effect == "NoSchedule")
  ' >/dev/null; then
    die 'Expected control-plane NoSchedule taint was not found.'
    return 1
  fi
}

assert_local_image() {
  if ! docker image inspect "$API_IMAGE" >/dev/null 2>&1; then
    die "Local image not found: $API_IMAGE"
    return 1
  fi
}

assert_source_secret() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    die "Secret file not found: $path"
    return 1
  fi
  if ! jq -e '
    has("JWT_SECRET") and
    has("TOTP_ENCRYPTION_ACTIVE_KEY_ID") and
    has("TOTP_ENCRYPTION_KEYS") and
    has("RECOVERY_HMAC_ACTIVE_KEY_ID") and
    has("RECOVERY_HMAC_KEYS") and
    has("AUTH_THROTTLE_HMAC_KEY")
  ' "$path" >/dev/null; then
    die 'Source secret is missing required keys.'
    return 1
  fi
}

build_kubernetes_secret_json() {
  local source_file="$1" output_file="$2" mongo_uri="$3"
  install -m 600 /dev/null "$output_file" || return 1
  jq --arg mongo_uri "$mongo_uri" '. + {MONGO_URI: $mongo_uri}' \
    "$source_file" >"$output_file" || return 1
  chmod 600 "$output_file" || return 1
}

install_gateway_fabric() {
  local gateway_api_manifest ngf_crds ngf_deploy
  gateway_api_manifest="https://github.com/kubernetes-sigs/gateway-api/releases/download/v${GATEWAY_API_VERSION}/standard-install.yaml"
  ngf_crds="https://raw.githubusercontent.com/nginx/nginx-gateway-fabric/v${NGF_VERSION}/deploy/crds.yaml"
  ngf_deploy="https://raw.githubusercontent.com/nginx/nginx-gateway-fabric/v${NGF_VERSION}/deploy/default/deploy.yaml"

  kube apply --server-side -f "$gateway_api_manifest" || return 1
  kube apply --server-side -f "$ngf_crds" || return 1
  kube apply -f "$ngf_deploy" || return 1
  kube rollout status deployment/nginx-gateway -n nginx-gateway --timeout=5m || return 1
  kube wait gatewayclass/nginx --for=condition=Accepted --timeout=2m || return 1
}

reconcile_secret() (
  local temporary_directory secret_file
  temporary_directory="$(mktemp -d)" || return 1
  secret_file="$temporary_directory/kubernetes.json"
  trap 'rm -rf "$temporary_directory"' EXIT

  kube create namespace "$APP_NAMESPACE" --dry-run=client -o yaml | \
    kube apply -f - || return 1
  kube create namespace "$GATEWAY_NAMESPACE" --dry-run=client -o yaml | \
    kube apply -f - || return 1
  build_kubernetes_secret_json "$SOURCE_SECRET" "$secret_file" "$MONGO_URI" || return 1
  kube create secret generic babki-api-secrets \
    --namespace "$APP_NAMESPACE" \
    --from-file="kubernetes.json=$secret_file" \
    --dry-run=client -o yaml | kube apply -f - >/dev/null || return 1
)

apply_application() {
  kube apply --dry-run=server -k "$LOCAL_OVERLAY_DIR" >/dev/null || return 1
  kube apply -f "$BASE_DIR/network-policies.yaml" || return 1
  kube delete job mongo-bootstrap -n "$APP_NAMESPACE" --ignore-not-found --wait=true || return 1
  kube apply -k "$LOCAL_OVERLAY_DIR" || return 1
}

wait_for_httproute() {
  local deadline remaining request_timeout_seconds sleep_seconds route_json
  deadline=$((SECONDS + HTTPROUTE_WAIT_TIMEOUT_SECONDS))

  while ((SECONDS < deadline)); do
    remaining=$((deadline - SECONDS))
    request_timeout_seconds="$HTTPROUTE_REQUEST_TIMEOUT_SECONDS"
    if ((request_timeout_seconds > remaining)); then
      request_timeout_seconds="$remaining"
    fi

    if route_json="$(kube get httproute babki-api -n "$APP_NAMESPACE" -o json \
      --request-timeout="${request_timeout_seconds}s")" && jq -e \
      --arg controller_name "$GATEWAY_CONTROLLER_NAME" \
      --arg gateway_namespace "$GATEWAY_NAMESPACE" '
        .metadata.generation as $generation |
        any(.status.parents[]?;
          .parentRef.name == "babki" and
          .parentRef.namespace == $gateway_namespace and
          .parentRef.sectionName == "http" and
          .controllerName == $controller_name and
          any(.conditions[]?;
            .type == "Accepted" and
            .status == "True" and
            .observedGeneration == $generation
          )
        )
      ' <<<"$route_json" >/dev/null; then
      return 0
    fi

    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || break
    sleep_seconds="$HTTPROUTE_POLL_INTERVAL_SECONDS"
    if ((sleep_seconds > remaining)); then
      sleep_seconds="$remaining"
    fi
    sleep "$sleep_seconds" || return 1
  done

  die 'HTTPRoute was not Accepted by the expected Gateway parent in time.'
}

wait_for_stack() {
  kube rollout status statefulset/mongo -n "$APP_NAMESPACE" --timeout=5m || return 1
  if ! kube wait job/mongo-bootstrap -n "$APP_NAMESPACE" --for=condition=Complete --timeout=5m; then
    kube logs job/mongo-bootstrap -n "$APP_NAMESPACE" >&2 || true
    return 1
  fi
  kube rollout status deployment/babki-api -n "$APP_NAMESPACE" --timeout=5m || return 1
  kube wait gateway/babki -n "$GATEWAY_NAMESPACE" --for=condition=Programmed --timeout=5m || return 1
  wait_for_httproute || return 1
}

create_network_probe_namespace() {
  kube create -f - -o name <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  generateName: babki-network-probe-
EOF
}

create_network_probe_pod() {
  local namespace="$1" generate_name="$2" image="$3"
  kube create -f - -o name <<EOF
apiVersion: v1
kind: Pod
metadata:
  generateName: ${generate_name}
  namespace: ${namespace}
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: ${image}
      command:
        - sleep
        - '300'
EOF
}

cleanup_network_probe_namespace() {
  local namespace="${1:-}" deadline remaining request_timeout_seconds sleep_seconds namespace_resource
  [[ -z "$namespace" ]] && return 0
  if ! kube delete namespace "$namespace" \
    --ignore-not-found --wait=false >/dev/null 2>&1; then
    die "Failed to delete probe namespace: $namespace"
    return 1
  fi

  deadline=$((SECONDS + PROBE_CLEANUP_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    remaining=$((deadline - SECONDS))
    request_timeout_seconds="$PROBE_CLEANUP_REQUEST_TIMEOUT_SECONDS"
    if ((request_timeout_seconds > remaining)); then
      request_timeout_seconds="$remaining"
    fi
    namespace_resource="$(kube get namespace "$namespace" --ignore-not-found -o name \
      --request-timeout="${request_timeout_seconds}s")" || {
      die "Failed to observe probe namespace deletion: $namespace"
      return 1
    }
    [[ -z "$namespace_resource" ]] && return 0

    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || break
    sleep_seconds="$PROBE_CLEANUP_POLL_INTERVAL_SECONDS"
    if ((sleep_seconds > remaining)); then
      sleep_seconds="$remaining"
    fi
    sleep "$sleep_seconds" || return 1
  done

  die "Probe namespace deletion did not complete in time: $namespace"
}

verify_stack() (
  local mongo_nodes bound_pvcs replica_status
  local ready_api external_service_count api_test_pod mongo_test_pod
  local probe_namespace_resource probe_namespace network_policy_count
  local api_probe_resource mongo_probe_resource api_probe_status
  local mongo_probe_result mongo_probe_status mongo_probe_error

  mongo_nodes="$(kube get pods -n "$APP_NAMESPACE" \
    -l app.kubernetes.io/name=mongo -o json | \
    jq -r '[.items[].spec.nodeName] | unique | length')" || return 1
  if [[ "$mongo_nodes" != '3' ]]; then
    die 'MongoDB members are not spread across three nodes.'
    return 1
  fi

  bound_pvcs="$(kube get pvc -n "$APP_NAMESPACE" -o json | jq '[
    .items[] |
    select(.metadata.name | startswith("data-mongo-")) |
    select(.status.phase == "Bound")
  ] | length')" || return 1
  if [[ "$bound_pvcs" != '3' ]]; then
    die "Expected three Bound MongoDB PVCs; found $bound_pvcs."
    return 1
  fi

  replica_status="$(kube exec -n "$APP_NAMESPACE" mongo-0 -- \
    mongosh --quiet --eval '
      print(EJSON.stringify(rs.status().members.map(({name, stateStr, health}) => ({name, stateStr, health}))));
    ')" || return 1
  if ! jq -e '
    def expected_members: [
      "mongo-0.mongo.babki.svc.cluster.local:27017",
      "mongo-1.mongo.babki.svc.cluster.local:27017",
      "mongo-2.mongo.babki.svc.cluster.local:27017"
    ];
    length == 3 and
    ([.[].name] | sort) == (expected_members | sort) and
    all(.[]; .health == 1) and
    ([.[] | select(.stateStr == "PRIMARY")] | length) == 1 and
    ([.[] | select(.stateStr == "SECONDARY")] | length) == 2
  ' <<<"$replica_status" >/dev/null; then
    die 'Replica set does not have the exact healthy three-member PRIMARY/SECONDARY topology.'
    return 1
  fi

  ready_api="$(kube get deployment babki-api -n "$APP_NAMESPACE" -o jsonpath='{.status.readyReplicas}')" || return 1
  if [[ "$ready_api" != '2' ]]; then
    die "Expected two ready API replicas; found ${ready_api:-0}."
    return 1
  fi

  if ! kube get services -n "$APP_NAMESPACE" -o json | jq -e '
    all(.items[]; .spec.type == "ClusterIP")
  ' >/dev/null; then
    die 'An application Service is externally exposed.'
    return 1
  fi
  external_service_count="$(kube get services -n "$GATEWAY_NAMESPACE" -o json | \
    jq '[.items[] | select(.spec.type == "LoadBalancer")] | length')" || return 1
  if [[ "$external_service_count" -lt 1 ]]; then
    die 'Gateway LoadBalancer Service was not created.'
    return 1
  fi

  curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
    http://api.babki.localhost/api/v1 >/dev/null || return 1

  probe_namespace=''
  trap 'cleanup_network_probe_namespace "${probe_namespace:-}" || true' EXIT

  probe_namespace_resource="$(create_network_probe_namespace)" || return 1
  if [[ "$probe_namespace_resource" != namespace/babki-network-probe-* ]]; then
    die 'Probe namespace creation returned an unexpected resource name.'
    return 1
  fi
  probe_namespace="${probe_namespace_resource#namespace/}"
  kube wait "namespace/$probe_namespace" \
    --for=jsonpath='{.status.phase}'=Active --timeout=1m >/dev/null || return 1

  api_probe_resource="$(
    create_network_probe_pod "$probe_namespace" \
      'babki-deny-api-' 'curlimages/curl:8.12.1'
  )" || return 1
  if [[ "$api_probe_resource" != pod/* ]]; then
    die 'API probe pod creation returned an unexpected resource name.'
    return 1
  fi
  api_test_pod="${api_probe_resource#pod/}"

  mongo_probe_resource="$(
    create_network_probe_pod "$probe_namespace" 'babki-deny-mongo-' 'mongo:7'
  )" || return 1
  if [[ "$mongo_probe_resource" != pod/* ]]; then
    die 'MongoDB probe pod creation returned an unexpected resource name.'
    return 1
  fi
  mongo_test_pod="${mongo_probe_resource#pod/}"

  kube wait "pod/$api_test_pod" -n "$probe_namespace" \
    --for=condition=Ready --timeout=2m >/dev/null || return 1
  kube wait "pod/$mongo_test_pod" -n "$probe_namespace" \
    --for=condition=Ready --timeout=2m >/dev/null || return 1

  network_policy_count="$(kube get networkpolicy -n "$probe_namespace" -o json | \
    jq '.items | length')" || return 1
  if [[ "$network_policy_count" != '0' ]]; then
    die 'Probe namespace unexpectedly contains NetworkPolicies.'
    return 1
  fi

  if ! kube exec -n "$probe_namespace" "$api_test_pod" -- \
    nslookup babki-api.babki.svc.cluster.local >/dev/null; then
    die 'API probe pod could not resolve the API Service.'
    return 1
  fi
  if ! kube exec -n "$probe_namespace" "$api_test_pod" -- \
    nslookup mongo.babki.svc.cluster.local >/dev/null; then
    die 'API probe pod could not resolve the MongoDB Service.'
    return 1
  fi

  api_probe_status="$(kube exec -n "$probe_namespace" "$api_test_pod" -- sh -c '
    curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      http://babki-api.babki.svc.cluster.local:5001/api/v1 >/dev/null 2>&1
    status=$?
    printf "%s\n" "$status"
  ')" || return 1
  case "$api_probe_status" in
    7 | 28) ;;
    0)
      die 'Unrelated pod unexpectedly reached the API directly.'
      return 1
      ;;
    *)
      die "API isolation probe failed unexpectedly with curl exit $api_probe_status."
      return 1
      ;;
  esac

  if ! kube exec -n "$probe_namespace" "$mongo_test_pod" -- \
    getent hosts mongo.babki.svc.cluster.local >/dev/null; then
    die 'MongoDB probe pod could not resolve the MongoDB Service.'
    return 1
  fi
  if ! kube exec -n "$probe_namespace" "$mongo_test_pod" -- \
    mongosh --version >/dev/null; then
    die 'MongoDB probe pod does not provide mongosh.'
    return 1
  fi
  mongo_probe_result="$(kube exec -n "$probe_namespace" "$mongo_test_pod" -- sh -c '
    output="$(mongosh "mongodb://mongo.babki.svc.cluster.local:27017/admin?serverSelectionTimeoutMS=3000" \
      --quiet \
      --eval "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)" 2>&1)"
    status=$?
    printf "status:%s\n%s\n" "$status" "$output"
  ')" || return 1
  mongo_probe_status="${mongo_probe_result%%$'\n'*}"
  if [[ "$mongo_probe_result" == *$'\n'* ]]; then
    mongo_probe_error="${mongo_probe_result#*$'\n'}"
  else
    mongo_probe_error=''
  fi
  case "$mongo_probe_status" in
    status:1)
      if ! grep -Eq \
        'MongoServerSelectionError: Server selection timed out after 3000 ms' \
        <<<"$mongo_probe_error"; then
        die 'MongoDB isolation probe did not report the expected bounded server-selection timeout.'
        return 1
      fi
      ;;
    status:0)
      die 'Unrelated pod unexpectedly reached MongoDB directly.'
      return 1
      ;;
    *)
      die "MongoDB isolation probe failed unexpectedly with mongosh exit $mongo_probe_status."
      return 1
      ;;
  esac

  cleanup_network_probe_namespace "$probe_namespace" || return 1
  probe_namespace=''
  trap - EXIT
)
