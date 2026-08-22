# Kubernetes manifests

The local stack uses a Kustomize base plus a local overlay. The base remains
split by responsibility so each part can be inspected and changed independently:

- `base/namespaces.yaml` creates the application and Gateway data-plane namespaces;
- `base/network-policies.yaml` establishes default-deny isolation and the required
  allow rules;
- `base/mongo.yaml` runs the persistent three-member MongoDB replica set and its
  bootstrap Job;
- `base/api.yaml` runs the API replicas and exposes them only inside the cluster;
- `base/gateway.yaml` routes `api.babki.localhost` from NGINX Gateway Fabric to the
  internal API Service.

`overlays/local/config.env` is the source of the local non-secret API
configuration. Its `kustomization.yaml` generates `babki-api-config` with a
content hash in the name and updates the API Deployment reference. Changing
`config.env` therefore changes the Pod template and triggers a rolling update.
Plain `kubectl apply -k` does not prune older hashed ConfigMaps. They are
harmless locally and can be removed manually after the new API rollout is
healthy; automated pruning is intentionally outside this deployment script.

Inspect the exact resources before applying them with:

```bash
kubectl kustomize k8s/overlays/local
```

The deployment script validates and applies this overlay. It applies the
NetworkPolicy resources separately before the complete overlay so newly
created workloads start under default-deny isolation.

Application secret values intentionally do not live here. `npm run k8s:deploy`
creates or reconciles `Secret/babki-api-secrets` from the ignored local secret
file before applying the overlay. Gateway API CRDs and the NGINX Gateway
Fabric controller are cluster infrastructure installed by
`npm run k8s:bootstrap`.
