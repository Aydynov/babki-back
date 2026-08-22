# Local Kubernetes deployment

This deployment is for local Docker Desktop development only. MongoDB has no
authentication or TLS; do not expose this cluster or reuse its manifests in a
shared or production environment.

## Prerequisites

- Docker Desktop Kubernetes context `docker-desktop`
- three Ready nodes
- `kubectl`, `docker`, `jq`, `curl`, Ruby, and the local image `babki-back-api:latest`
- `config/secrets/docker-compose.local.json`

Build the API image and generate the local secret file before deploying if they
do not already exist.

## Complete first-time setup

```bash
npm run k8s:test
npm run k8s:local
```

`k8s:local` runs the infrastructure bootstrap, application deployment, and
post-deployment verification in order. It stops immediately if any phase
fails.

## Workflow phases

Run the phases separately when the cluster infrastructure is already set up
or when troubleshooting a specific step.

### Bootstrap cluster infrastructure

```bash
npm run k8s:bootstrap
```

This validates the expected three-node Docker Desktop cluster, installs the
pinned Gateway API CRDs and NGINX Gateway Fabric, and waits for the GatewayClass
to be accepted. Run it once after creating or resetting the local cluster, or
after changing its infrastructure.

### Deploy the application

```bash
npm run k8s:deploy
```

This validates the local API image and secret source, reconciles the Kubernetes
Secret, validates and applies the local Kustomize overlay, recreates the
MongoDB bootstrap Job, and waits for MongoDB, the API, Gateway, and HTTPRoute.
It does not reinstall Gateway infrastructure or run the network-isolation
probes.

### Verify the deployed stack

```bash
npm run k8s:verify
```

This checks the MongoDB topology and PVCs, API replicas and external route, and
uses temporary pods in a generated namespace to verify that unrelated workloads
cannot connect directly to the API or MongoDB. The temporary namespace is
deleted after the checks.

## Manifest layout

The application manifests are split by responsibility:

```text
k8s/
  base/
    kustomization.yaml
    namespaces.yaml        # application and Gateway namespaces
    network-policies.yaml  # default-deny and explicit allow rules
    mongo.yaml             # Service, StatefulSet, bootstrap Job, and PDB
    api.yaml               # Service, Deployment, and PDB
    gateway.yaml           # Gateway and HTTPRoute
  overlays/
    local/
      kustomization.yaml   # composes the base and generates the ConfigMap
      config.env           # local non-secret API configuration
```

Render the exact local resources without changing the cluster with
`kubectl kustomize k8s/overlays/local`. Kustomize generates a ConfigMap whose
name includes a hash of `config.env` and rewrites the API Deployment reference.
A configuration change therefore produces a new Pod template and a rolling
update instead of leaving existing process environment variables unchanged.
`kubectl apply -k` does not prune superseded hashed ConfigMaps; remove an old
one manually only after confirming that no running Pod references it.

`npm run k8s:deploy` performs a server-side dry run of the complete overlay,
applies NetworkPolicy before the workloads, then applies the overlay with
`kubectl apply -k k8s/overlays/local`.

Two pieces intentionally live outside the Kustomize configuration:

- `Secret/babki-api-secrets` is generated from the ignored local secret file by
  the deployment script;
- Gateway API CRDs and the NGINX Gateway Fabric controller are cluster-level
  infrastructure installed by `npm run k8s:bootstrap`.

## Inspect

```bash
kubectl get pods,pvc,svc -n babki -o wide
kubectl get gateway -n babki-gateway
kubectl get httproute -n babki
kubectl exec -n babki mongo-0 -- mongosh --quiet --eval \
  'rs.status().members.map(({name, stateStr}) => ({name, stateStr}))'
```

## Logs

```bash
kubectl logs -n babki deployment/babki-api --all-pods=true
kubectl logs -n babki statefulset/mongo --all-pods=true
kubectl logs -n babki job/mongo-bootstrap
```

## Safe repeat deployment

Re-run `npm run k8s:deploy`. It reconciles application resources without
reinstalling Gateway infrastructure, running isolation probes, deleting PVCs,
or generating new secret values. Run `npm run k8s:verify` separately when a
full post-deployment check is needed.

## Stop workloads without deleting data

```bash
kubectl scale deployment/babki-api -n babki --replicas=0
kubectl scale statefulset/mongo -n babki --replicas=0
```

Do not delete namespace `babki` or its PVCs unless database loss is intentional.

## Troubleshooting

### `ImagePullBackOff`

The API uses the local `babki-back-api:latest` image. Build it with Docker
Desktop's Docker daemon, then confirm it is available with
`docker image inspect babki-back-api:latest` and rerun the deployment.

### Pending PVCs

The deployment requires exactly three Ready Docker Desktop nodes and the
`standard` StorageClass. Inspect the claims and events with
`kubectl get pvc -n babki` and `kubectl describe pvc -n babki <claim-name>`;
restore the cluster shape or storage class before retrying.

### Failed bootstrap Job

Inspect `kubectl logs -n babki job/mongo-bootstrap` and verify that all three
MongoDB pods are Running and Ready. Then rerun `npm run k8s:deploy`; it removes
and recreates the bootstrap Job without deleting the MongoDB PVCs.

### Gateway not `Programmed`

Check the Gateway and NGINX Gateway Fabric controller pods/status:

```bash
kubectl describe gateway babki -n babki-gateway
kubectl get pods -n nginx-gateway
```

Run `npm run k8s:bootstrap` to reconcile the controller, wait for it to be
ready, then rerun `npm run k8s:deploy`.

### HTTPRoute not `Accepted`

Inspect the route status and its parent reference:

```bash
kubectl describe httproute babki-api -n babki
```

Confirm the `babki` Gateway in namespace `babki-gateway` is Programmed and that
the API Service and its pods are ready, then rerun the deployment.

### Local port 80 is busy

NGINX Gateway Fabric needs local port 80 for `api.babki.localhost`. Stop the
process or container that owns port 80, or free that port in Docker Desktop,
then redeploy. On macOS, `lsof -nP -iTCP:80 -sTCP:LISTEN` identifies the local
listener.
