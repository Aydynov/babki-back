# frozen_string_literal: true

require 'minitest/autorun'
require 'open3'
require 'set'
require 'yaml'

ROOT = File.expand_path('../..', __dir__)
MANIFEST_DIR = File.join(ROOT, 'k8s')
BASE_DIR = File.join(MANIFEST_DIR, 'base')
EXPECTED_MANIFEST_FILES = %w[
  namespaces.yaml
  network-policies.yaml
  mongo.yaml
  api.yaml
  gateway.yaml
].freeze
LOCAL_OVERLAY_DIR = File.join(MANIFEST_DIR, 'overlays', 'local')
MANIFEST_PATHS = EXPECTED_MANIFEST_FILES.map { |filename| File.join(BASE_DIR, filename) }.freeze
MANIFEST_CONTENT = MANIFEST_PATHS.map { |path| File.read(path) }.join("\n").freeze
DOCUMENTS = MANIFEST_PATHS.flat_map do |path|
  YAML.load_stream(File.read(path)).compact
end.freeze

def resource(kind, name, namespace = nil)
  DOCUMENTS.find do |document|
    document['kind'] == kind &&
      document.dig('metadata', 'name') == name &&
      (namespace.nil? || document.dig('metadata', 'namespace') == namespace)
  end || raise("Missing #{kind} #{namespace}/#{name}")
end

def rendered_local_resources
  stdout, stderr, status = Open3.capture3('kubectl', 'kustomize', LOCAL_OVERLAY_DIR)
  raise "Failed to render local Kustomize overlay: #{stderr}" unless status.success?

  YAML.load_stream(stdout).compact
end

class KubernetesManifestTest < Minitest::Test
  def test_manifests_are_split_by_responsibility
    assert_equal EXPECTED_MANIFEST_FILES.sort, MANIFEST_PATHS.map { |path| File.basename(path) }.sort
    refute File.exist?(File.join(ROOT, 'deployment.yaml'))

    expected_resources = {
      'namespaces.yaml' => [
        ['Namespace', nil, 'babki'],
        ['Namespace', nil, 'babki-gateway'],
      ],
      'mongo.yaml' => [
        ['Service', 'babki', 'mongo'],
        ['StatefulSet', 'babki', 'mongo'],
        ['Job', 'babki', 'mongo-bootstrap'],
        ['PodDisruptionBudget', 'babki', 'mongo'],
      ],
      'api.yaml' => [
        ['Service', 'babki', 'babki-api'],
        ['Deployment', 'babki', 'babki-api'],
        ['PodDisruptionBudget', 'babki', 'babki-api'],
      ],
      'network-policies.yaml' => %w[
        default-deny
        allow-dns
        allow-mongo-replication
        allow-mongo-clients
        allow-api-to-mongo
        allow-bootstrap-to-mongo
        allow-gateway-to-api
      ].map { |name| ['NetworkPolicy', 'babki', name] },
      'gateway.yaml' => [
        ['Gateway', 'babki-gateway', 'babki'],
        ['HTTPRoute', 'babki', 'babki-api'],
      ],
    }

    expected_resources.each do |filename, expected|
      path = File.join(BASE_DIR, filename)
      actual = YAML.load_stream(File.read(path)).compact.map do |document|
        [document['kind'], document.dig('metadata', 'namespace'), document.dig('metadata', 'name')]
      end
      assert_equal expected.to_set, actual.to_set, filename
    end
  end

  def test_local_overlay_generates_hashed_api_config_and_updates_deployment_reference
    assert File.exist?(File.join(BASE_DIR, 'kustomization.yaml'))
    assert File.exist?(File.join(LOCAL_OVERLAY_DIR, 'kustomization.yaml'))
    assert File.exist?(File.join(LOCAL_OVERLAY_DIR, 'config.env'))
    refute File.exist?(File.join(BASE_DIR, 'config.yaml'))

    documents = rendered_local_resources
    config_map = documents.find do |document|
      document['kind'] == 'ConfigMap' &&
        document.dig('metadata', 'name')&.start_with?('babki-api-config-')
    end
    refute_nil config_map
    assert_equal 'babki', config_map.dig('metadata', 'namespace')
    assert_match(/\Ababki-api-config-[a-z0-9]{10}\z/, config_map.dig('metadata', 'name'))
    assert_equal(
      {
        'NODE_ENV' => 'development',
        'PORT' => '5001',
        'API_PREFIX' => 'api/v1',
        'SECRETS_FILE_PATH' => 'config/secrets/kubernetes.json',
        'MONGO_DB_NAME' => 'babki_db',
        'MONGO_AUTH_ENABLED' => 'false',
        'JWT_EXPIRES_IN' => '7d',
        'TOTP_ENROLLMENT_ENABLED' => 'false',
        'TOTP_ISSUER' => 'Babki',
        'TRUST_PROXY' => '1',
        'AUTH_LIMIT_WINDOW_SECONDS' => '900',
        'AUTH_LIMIT_BLOCK_SECONDS' => '900',
        'AUTH_PASSWORD_EMAIL_FAILURES' => '5',
        'AUTH_PASSWORD_IP_FAILURES' => '50',
        'AUTH_CHALLENGE_FAILURES' => '5',
        'AUTH_SECOND_FACTOR_FAILURES' => '10',
        'TZ' => 'UTC',
      },
      config_map['data'],
    )

    deployment = documents.find do |document|
      document['kind'] == 'Deployment' && document.dig('metadata', 'name') == 'babki-api'
    end
    api = deployment.dig('spec', 'template', 'spec', 'containers').find do |container|
      container['name'] == 'api'
    end
    assert_equal config_map.dig('metadata', 'name'), api.dig('envFrom', 0, 'configMapRef', 'name')
  end

  def test_namespaces_and_secret_boundary
    assert resource('Namespace', 'babki')
    assert resource('Namespace', 'babki-gateway')
    refute DOCUMENTS.any? { |document| document['kind'] == 'Secret' }
    refute_includes MANIFEST_CONTENT, 'directConnection=true'
  end

  def test_resource_identities_are_unique
    identities = DOCUMENTS.map do |document|
      [
        document['kind'],
        document.dig('metadata', 'namespace'),
        document.dig('metadata', 'name'),
      ]
    end
    counts = identities.each_with_object(Hash.new(0)) { |identity, result| result[identity] += 1 }
    duplicates = counts.select { |_identity, count| count > 1 }

    assert_empty duplicates, "duplicate Kubernetes resource identities: #{duplicates.keys.inspect}"
  end

  def test_mongo_stateful_set_is_three_node_replica_set
    stateful_set = resource('StatefulSet', 'mongo', 'babki')
    assert_equal 3, stateful_set.dig('spec', 'replicas')
    assert_equal 'Parallel', stateful_set.dig('spec', 'podManagementPolicy')

    mongo = stateful_set.dig('spec', 'template', 'spec', 'containers').find do |container|
      container['name'] == 'mongo'
    end
    assert_equal 'mongo:7', mongo['image']
    assert_equal 27_017, mongo.dig('ports', 0, 'containerPort')
    assert_includes mongo['args'], '--replSet'
    assert_includes mongo['args'], 'rs0'
    assert_includes mongo['args'], '--bind_ip_all'

    tolerations = stateful_set.dig('spec', 'template', 'spec', 'tolerations')
    assert tolerations.any? { |item| item['key'] == 'node-role.kubernetes.io/control-plane' && item['effect'] == 'NoSchedule' }

    required = stateful_set.dig(
      'spec', 'template', 'spec', 'affinity', 'podAntiAffinity',
      'requiredDuringSchedulingIgnoredDuringExecution'
    )
    assert_equal 'kubernetes.io/hostname', required.first['topologyKey']

    claim = stateful_set.dig('spec', 'volumeClaimTemplates').first
    assert_equal 'standard', claim.dig('spec', 'storageClassName')
    assert_equal ['ReadWriteOnce'], claim.dig('spec', 'accessModes')
    assert_equal '2Gi', claim.dig('spec', 'resources', 'requests', 'storage')
  end

  def test_replica_set_bootstrap_uses_all_stable_members
    job = resource('Job', 'mongo-bootstrap', 'babki')
    script = job.dig('spec', 'template', 'spec', 'containers', 0, 'args', 0)
    assert_includes script, 'rs.initiate'
    (0..2).each do |ordinal|
      assert_includes script, "mongo-#{ordinal}.mongo.babki.svc.cluster.local:27017"
    end
    assert_includes script, 'isWritablePrimary'
  end

  def test_replica_set_bootstrap_passes_quoted_name_to_mongosh
    job = resource('Job', 'mongo-bootstrap', 'babki')
    script = job.dig('spec', 'template', 'spec', 'containers', 0, 'args', 0)
    mongosh_stub = <<~'BASH'
      mongosh() {
        local eval_arg=''
        while (($#)); do
          if [[ "$1" == '--eval' ]]; then
            shift
            eval_arg="${1:-}"
            break
          fi
          shift
        done

        case "$eval_arg" in
          *'rs.status().set'*) printf 'UNINITIALIZED\n' ;;
          *'rs.initiate'*)
            [[ "$eval_arg" == *'_id: "rs0"'* ]] || {
              printf 'replica-set name was not passed as a string\n' >&2
              return 42
            }
            ;;
        esac
      }
    BASH

    _stdout, stderr, status = Open3.capture3('bash', stdin_data: mongosh_stub + script)

    assert status.success?, stderr
  end

  def test_replica_set_bootstrap_accepts_primary_on_every_ordinal
    job = resource('Job', 'mongo-bootstrap', 'babki')
    script = job.dig('spec', 'template', 'spec', 'containers', 0, 'args', 0)
    mongosh_stub = <<~'BASH'
      sleep() { :; }

      mongosh() {
        local argument eval_arg='' target=''
        while (($#)); do
          argument="$1"
          shift
          case "$argument" in
            --host)
              target="${1:-}"
              shift
              ;;
            --eval)
              eval_arg="${1:-}"
              shift
              ;;
            mongodb://*)
              target="$argument"
              ;;
          esac
        done

        case "$eval_arg" in
          *'rs.status().set'*) printf 'rs0\n' ;;
          *'isWritablePrimary'*)
            [[ "$target" == "$PRIMARY_MEMBER" || "$target" == mongodb://*"$PRIMARY_MEMBER"* ]]
            ;;
        esac
      }
    BASH

    (0..2).each do |ordinal|
      primary = "mongo-#{ordinal}.mongo.babki.svc.cluster.local:27017"
      _stdout, stderr, status = Open3.capture3(
        { 'PRIMARY_MEMBER' => primary },
        'bash',
        stdin_data: mongosh_stub + script,
      )

      assert status.success?, "bootstrap rejected PRIMARY #{primary}: #{stderr}"
    end
  end

  def test_replica_set_bootstrap_job_has_hard_deadline
    job = resource('Job', 'mongo-bootstrap', 'babki')

    assert_equal 300, job.dig('spec', 'activeDeadlineSeconds')
  end

  def test_replica_set_bootstrap_times_out_an_unavailable_member
    job = resource('Job', 'mongo-bootstrap', 'babki')
    script = job.dig('spec', 'template', 'spec', 'containers', 0, 'args', 0)
    mongosh_stub = <<~'BASH'
      sleep_calls=0
      sleep() {
        SECONDS=$((SECONDS + 60))
        sleep_calls=$((sleep_calls + 1))
        if ((sleep_calls > 5)); then
          printf 'TEST_SLEEP_CAP_REACHED\n' >&2
          return 97
        fi
      }

      mongosh() {
        if [[ "$*" == *'ping: 1'* ]]; then
          if [[ "$*" != *'serverSelectionTimeoutMS=2000'* ]]; then
            printf 'MISSING_SERVER_SELECTION_TIMEOUT\n' >&2
          fi
          return 1
        fi
      }
    BASH

    _stdout, stderr, status = Open3.capture3('bash', stdin_data: mongosh_stub + script)

    refute status.success?
    assert_includes stderr, 'mongo-0.mongo.babki.svc.cluster.local:27017'
    refute_includes stderr, 'MISSING_SERVER_SELECTION_TIMEOUT'
    refute_includes stderr, 'TEST_SLEEP_CAP_REACHED'
  end

  def test_api_uses_internal_service_and_projected_secret
    deployment = resource('Deployment', 'babki-api', 'babki')
    assert_equal 2, deployment.dig('spec', 'replicas')

    pod_spec = deployment.dig('spec', 'template', 'spec')
    assert_equal 'mongo:7', pod_spec.dig('initContainers', 0, 'image')
    api = pod_spec['containers'].find { |container| container['name'] == 'api' }
    assert_equal 'babki-back-api:latest', api['image']
    assert_equal 'IfNotPresent', api['imagePullPolicy']
    assert_equal true, api.dig('securityContext', 'runAsNonRoot')
    assert_equal 1_000, api.dig('securityContext', 'runAsUser')
    assert_equal '/api/v1', api.dig('readinessProbe', 'httpGet', 'path')
    assert_equal '/app/config/secrets/kubernetes.json', api.dig('volumeMounts', 0, 'mountPath')
    assert_equal 'babki-api-secrets', pod_spec.dig('volumes', 0, 'secret', 'secretName')

    service = resource('Service', 'babki-api', 'babki')
    assert_equal 'ClusterIP', service.dig('spec', 'type')
    assert_equal 5001, service.dig('spec', 'ports', 0, 'port')

    mongo_service = resource('Service', 'mongo', 'babki')
    assert_equal 'None', mongo_service.dig('spec', 'clusterIP')
    assert_equal true, mongo_service.dig('spec', 'publishNotReadyAddresses')
  end

  def test_gateway_api_is_the_only_external_route
    gateway = resource('Gateway', 'babki', 'babki-gateway')
    assert_equal 'nginx', gateway.dig('spec', 'gatewayClassName')
    assert_equal 'api.babki.localhost', gateway.dig('spec', 'listeners', 0, 'hostname')
    assert_equal 80, gateway.dig('spec', 'listeners', 0, 'port')

    route = resource('HTTPRoute', 'babki-api', 'babki')
    assert_equal ['api.babki.localhost'], route.dig('spec', 'hostnames')
    assert_equal 'babki-gateway', route.dig('spec', 'parentRefs', 0, 'namespace')
    assert_equal 'babki-api', route.dig('spec', 'rules', 0, 'backendRefs', 0, 'name')
    assert_equal 5001, route.dig('spec', 'rules', 0, 'backendRefs', 0, 'port')

    exposed = DOCUMENTS.select do |document|
      document['kind'] == 'Service' && %w[NodePort LoadBalancer].include?(document.dig('spec', 'type'))
    end
    assert_empty exposed
  end

  def test_network_policies_have_only_the_exact_required_allow_rules
    mongo_selector = { 'matchLabels' => { 'app.kubernetes.io/name' => 'mongo' } }
    api_selector = { 'matchLabels' => { 'app.kubernetes.io/name' => 'babki-api' } }
    bootstrap_selector = { 'matchLabels' => { 'app.kubernetes.io/name' => 'mongo-bootstrap' } }
    mongo_port = [{ 'protocol' => 'TCP', 'port' => 27_017 }]
    expected_specs = {
      'default-deny' => {
        'podSelector' => {},
        'policyTypes' => %w[Ingress Egress],
      },
      'allow-dns' => {
        'podSelector' => {},
        'policyTypes' => ['Egress'],
        'egress' => [{
          'to' => [{
            'namespaceSelector' => {
              'matchLabels' => { 'kubernetes.io/metadata.name' => 'kube-system' },
            },
            'podSelector' => { 'matchLabels' => { 'k8s-app' => 'kube-dns' } },
          }],
          'ports' => [
            { 'protocol' => 'UDP', 'port' => 53 },
            { 'protocol' => 'TCP', 'port' => 53 },
          ],
        }],
      },
      'allow-mongo-replication' => {
        'podSelector' => mongo_selector,
        'policyTypes' => %w[Ingress Egress],
        'ingress' => [{ 'from' => [{ 'podSelector' => mongo_selector }], 'ports' => mongo_port }],
        'egress' => [{ 'to' => [{ 'podSelector' => mongo_selector }], 'ports' => mongo_port }],
      },
      'allow-mongo-clients' => {
        'podSelector' => mongo_selector,
        'policyTypes' => ['Ingress'],
        'ingress' => [{
          'from' => [
            { 'podSelector' => api_selector },
            { 'podSelector' => bootstrap_selector },
          ],
          'ports' => mongo_port,
        }],
      },
      'allow-api-to-mongo' => {
        'podSelector' => api_selector,
        'policyTypes' => ['Egress'],
        'egress' => [{ 'to' => [{ 'podSelector' => mongo_selector }], 'ports' => mongo_port }],
      },
      'allow-bootstrap-to-mongo' => {
        'podSelector' => bootstrap_selector,
        'policyTypes' => ['Egress'],
        'egress' => [{ 'to' => [{ 'podSelector' => mongo_selector }], 'ports' => mongo_port }],
      },
      'allow-gateway-to-api' => {
        'podSelector' => api_selector,
        'policyTypes' => ['Ingress'],
        'ingress' => [{
          'from' => [{
            'namespaceSelector' => {
              'matchLabels' => { 'kubernetes.io/metadata.name' => 'babki-gateway' },
            },
          }],
          'ports' => [{ 'protocol' => 'TCP', 'port' => 5001 }],
        }],
      },
    }
    policies = DOCUMENTS.select { |document| document['kind'] == 'NetworkPolicy' }

    assert_equal expected_specs.keys.sort, policies.map { |policy| policy.dig('metadata', 'name') }.sort
    expected_specs.each do |name, expected_spec|
      assert_equal expected_spec, resource('NetworkPolicy', name, 'babki')['spec'], name
    end
  end
end
