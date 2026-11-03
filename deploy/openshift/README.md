# Deploying to OpenShift

`deploy.sh` builds an image, renders the templates here and rolls the app out to one project. `deploy.sh delete`
removes what a deploy created. The script changes to the repository root first, so it runs from anywhere and always
reads `.env` and builds the `Dockerfile` from there.

| File | What it is |
| --- | --- |
| [deploy.sh](deploy.sh) | The deploy: secret, image, objects, rollout. With `delete`, the removal. Every option is an environment variable. |
| [app.yaml](app.yaml) | Template of the runtime objects: volume claim, Deployment, Service, Route. |
| [build.yaml](build.yaml) | Template of the in-cluster build objects: ImageStream and BuildConfig. Used only without `IMAGE`. |
| [tls.yaml](tls.yaml) | Template of the cert-manager Certificate for the Route, and the Role that lets the router read its secret. Used only with `CERT_MANAGER=1`. |
| [acme-issuer.yaml](acme-issuer.yaml) | Template of the project's Let's Encrypt Issuer, HTTP-01 through the router on `openshift-default`, in the same shape as the other projects'. Applied only with `CERT_MANAGER=1` when the project has no Issuer of that name. |

## Requirements

- `oc`, logged in to the cluster, and `git` (the image tag is the commit).
- `podman`, only for a local build.
- `SPEAKER_KEY`, in the environment or in `.env`, for the first deploy.
- For a cert-manager certificate only: cert-manager on the cluster (for example the cert-manager Operator for Red Hat
  OpenShift), and a Route API with `spec.tls.externalCertificate`. The script checks both and stops if either is
  missing; `oc explain route.spec.tls.externalCertificate` shows whether the cluster has it.

## Deploy

In-cluster build, the default. The cluster needs the Build capability (the `builder` service account exists):

```bash
PROJECT=ctx-talk deploy/openshift/deploy.sh
```

Local build with podman, pushed to a registry the cluster can reach. This works on every cluster. Run `podman login`
to the registry first:

```bash
PROJECT=ctx-talk IMAGE=quay.io/<you>/ctx-audience-app deploy/openshift/deploy.sh
```

When it finishes, the script prints the four URLs, then the label that identifies what it created and how to remove
it:

```
participants : https://<host><path>/session/main
display      : https://<host><path>/session/main/display
control      : https://<host><path>/session/main/control?key=<SPEAKER_KEY>
facilitator  : https://<host><path>/session/main/facilitator?key=<SPEAKER_KEY>

label        : ctx-audience-app/deployed-set=<NAME>
               Every object this deploy created in project <PROJECT> carries it.
list         : oc get <kinds> -n <PROJECT> -l ctx-audience-app/deployed-set=<NAME>
remove       : oc delete <kinds> -n <PROJECT> -l ctx-audience-app/deployed-set=<NAME>
               or: PROJECT=<PROJECT> NAME=<NAME> deploy/openshift/deploy.sh delete
               The script lists the set, asks first and unlinks the pull secret.
               Both delete the volume claim, and with it the room's snapshot, event log and exports.
               With the script, KEEP_DATA=1 keeps the volume claim.
```

`<kinds>` is `deployment,service,route,persistentvolumeclaim,secret`, plus `buildconfig,imagestream` on a cluster that
has the Build capability. When the script created the project, one more line says so.

Deploying again rebuilds the image, re-applies the objects and restarts the pod. The volume claim and the secret are
kept, so the room's snapshot survives.

## The deployed set

Everything one deploy creates is one set, identified by one label:

```
ctx-audience-app/deployed-set=<NAME>
```

`NAME` defaults to `ctx-audience-app`, so two names in one project are two sets that can be removed separately.

`deploy.sh` adds the label to every manifest before applying it, in one function, `apply_to_set`. The templates name
the label as well, so applying them by hand gives the same result.

| What | How it gets the label |
| --- | --- |
| Secrets `<NAME>-secrets`, `<NAME>-pull` | `apply_to_set`. A secret kept from an earlier deploy is not re-applied, so the script labels it in place on every deploy. |
| ImageStream, BuildConfig | `apply_to_set`, and the `labels` of [build.yaml](build.yaml), which a Template adds to every object. |
| Builds | The cluster copies the BuildConfig's labels to each build. |
| Volume claim, Deployment, Service, Route | `apply_to_set`, and the `labels` of [app.yaml](app.yaml). |
| Certificate, Role, RoleBinding | `apply_to_set`, and the `labels` of [tls.yaml](tls.yaml). |
| Secret `<NAME>-tls` | cert-manager creates it with the labels in the Certificate's `secretTemplate`. |
| ReplicaSets, pods | The Deployment's pod template names the label. |

The objects from `app.yaml` also keep the `app=<NAME>` label, which the Deployment and Service select pods by.

To change any of this, start with the "CHANGING THIS SCRIPT" notes at the top of [deploy.sh](deploy.sh):

- **Another object in a deploy.** Pipe its manifest to `apply_to_set`. If its kind is new, add the kind to the kinds
  lists in part 2 of the script, or `delete` and the printed commands will not see it.
- **Another label name.** Change `SET_LABEL_KEY` in the script and the same key in `app.yaml` and `tls.yaml`, twice
  each, and in `build.yaml`, once. A deploy stops if a template does not name the key. Delete existing rooms first:
  objects labelled under the old key are not found under the new one.

The project's Issuer is not in the set either: like the issuers of the other projects it is shared by everything in
the project, so a deploy creates it only when it is missing and `delete` leaves it.

A project is the exception. A project admin cannot label one, so a project the script creates is marked in its
description instead: `Context Window Live. Created by ctx-audience-app deploy.sh.` The script reads that mark before
it will delete a project.

## Options

Every option is an environment variable. The deployment options are read from the environment only, never from `.env`.

| Variable | Default | Notes |
| --- | --- | --- |
| `PROJECT` | the current project (`oc project -q`) | Created when it does not exist. `NAMESPACE` is an alias. |
| `NAME` | `ctx-audience-app` | Names every object and prefixes the secrets. Two names give two independent rooms in one project. |
| `ROUTE_HOST` | `<NAME>-<PROJECT>.<apps domain>` | A name outside the apps domain needs a DNS record to the router and, unless the router's wildcard certificate covers it, the TLS files below. |
| `ROUTE_PATH` | the whole host | Path prefix such as `/talk`, to share a hostname with other apps. The app serves itself under it. `talk` and `/talk/` both become `/talk`. |
| `ROUTE_TIMEOUT` | `1h` | HAProxy timeout on the Route. WebSockets idle between phases, so keep it long. |
| `ROUTE_TLS_CERT_FILE`, `ROUTE_TLS_KEY_FILE`, `ROUTE_TLS_CA_FILE` | the router's certificate | PEM files for the Route's edge TLS. The key is required with the certificate; the CA chain is optional. |
| `CERT_MANAGER` | `0` | `1` gets the Route's certificate for `ROUTE_HOST` from cert-manager. Not with the TLS files above. See [A certificate from cert-manager](#a-certificate-from-cert-manager). |
| `CERT_ISSUER` | `letsencrypt` | The issuer to use. An Issuer of that name is created in `PROJECT` when there is none. |
| `CERT_ISSUER_KIND` | `Issuer` | `ClusterIssuer` to use a cluster-wide one instead; it is never created. |
| `ACME_SERVER` | Let's Encrypt production | ACME directory of an Issuer the script creates. Staging is `https://acme-staging-v02.api.letsencrypt.org/directory`. |
| `PUBLIC_URL` | `https://<route host><ROUTE_PATH>` | Where the QR code points. Set it when another name (a CDN, a short link) fronts the Route. |
| `SHORT_URL` | the site root | Text the lobby prints under the QR code, e.g. a short link that redirects to the room. Display only: the QR code, Route and certificate are unchanged. Unset it on a later deploy and the lobby goes back to the site root. The placeholder in `.env.example` is not read here; the pod refuses to start if a placeholder reaches it. |
| `NOTES_READONLY` | `1` | `1` turns saving speaker notes off; the notes view still shows the `notes/speaker-notes.md` built into the image. `0` turns saving on, into the container's copy of the file, which the next deploy or pod restart replaces. Edit notes in the repository and deploy again. |
| `STORAGE_CLASS` | the cluster's default class | Fixed once the claim exists. |
| `STORAGE_SIZE` | `1Gi` | Fixed once the claim exists. |
| `CPU_REQUEST`, `MEMORY_REQUEST` | `100m`, `128Mi` | |
| `CPU_LIMIT`, `MEMORY_LIMIT` | `1`, `512Mi` | |
| `IMAGE` | unset: build in-cluster | Repository to build into with podman and push to. A tag on it is ignored. |
| `PLATFORM` | `linux/amd64` | Platform of the local build. `linux/arm64` for Arm nodes. |
| `TAG` | git short SHA, plus `-dirty` | Image tag. |
| `REFRESH_SECRET` | `0` | `1` rewrites `<NAME>-secrets` from the environment and `.env`. |
| `YES` | `0` | With `delete`: `1` deletes without the confirmation prompt. Required when there is no terminal. |
| `KEEP_DATA` | `0` | With `delete`: `1` keeps the volume claim, and with it the room's snapshot, event log and exports. |
| `DELETE_PROJECT` | `0` | With `delete`: `1` deletes the project too, but only one this script created and only once it holds nothing else. |

## Secrets

`<NAME>-secrets` holds `SPEAKER_KEY` and the live-model settings from [.env.example](../../.env.example):
`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_EFFORT`,
`LLM_MAX_TOKENS` and `LLM_TIMEOUT_MS`. Each value comes from the environment first, then from `.env`.

The secret is created on the first deploy and then kept. To change the speaker key or the model, rewrite it; the
deploy restarts the pod, which picks up the new values:

```bash
REFRESH_SECRET=1 deploy/openshift/deploy.sh
```

With `IMAGE`, when podman's auth file exists (`REGISTRY_AUTH_FILE`, else `$XDG_RUNTIME_DIR/containers/auth.json`,
else `~/.config/containers/auth.json`), the script copies it into the pull secret `<NAME>-pull` and links it to the
`default` service account. The secret carries every login in that file; point `REGISTRY_AUTH_FILE` at a file with only
the one registry to limit it.

## Images

Each image is tagged with the git short SHA, plus `-dirty` when tracked files have uncommitted changes, so every
commit gives the Deployment a new image reference to pull. `latest` is updated as well.

- In-cluster, the BuildConfig streams the working tree (minus `.dockerignore`) to the cluster, builds the `Dockerfile`
  into `<NAME>:latest`, and the script tags that `<NAME>:<TAG>`.
- Locally, podman builds `<IMAGE>:<TAG>` and `<IMAGE>:latest` and pushes both.

Redeploying the same commit with different uncommitted changes reuses the `-dirty` tag, and a node that already pulled
it may keep its copy. Set `TAG` to something new to force a fresh reference.

## Examples

Share a hostname with other apps under a path, on a chosen storage class:

```bash
PROJECT=talks NAME=ctx-rehearsal ROUTE_HOST=talks.example.com ROUTE_PATH=/ctx STORAGE_CLASS=gp3-csi deploy/openshift/deploy.sh
```

A custom hostname with its own certificate:

```bash
ROUTE_HOST=ctx.example.com ROUTE_TLS_CERT_FILE=ctx.crt ROUTE_TLS_KEY_FILE=ctx.key ROUTE_TLS_CA_FILE=chain.pem deploy/openshift/deploy.sh
```

A custom hostname with a Let's Encrypt certificate from cert-manager:

```bash
PROJECT=ctx-talk ROUTE_HOST=ctx.example.com CERT_MANAGER=1 deploy/openshift/deploy.sh
```

A second, independent room next to the first:

```bash
PROJECT=ctx-talk NAME=ctx-rehearsal deploy/openshift/deploy.sh
```

## What gets created

Every object below carries `ctx-audience-app/deployed-set=<NAME>`.

| Kind | Name | Notes |
| --- | --- | --- |
| Project | `<PROJECT>` | Only when it does not exist. Marked in its description, not by the label. |
| Secret | `<NAME>-secrets` | Speaker key and model settings, loaded into the container's environment. |
| Secret | `<NAME>-pull` | Local build only, when podman's auth file exists. |
| ImageStream, BuildConfig | `<NAME>` | In-cluster build only. |
| PersistentVolumeClaim | `<NAME>-data` | ReadWriteOnce, mounted at `/app/data`: the snapshot, event log and exports. |
| Deployment | `<NAME>` | One replica with the `Recreate` strategy. The store is in-memory, so two pods must never own the room. Probes hit `<ROUTE_PATH>/api/health`. |
| Service | `<NAME>` | Port 3000. |
| Route | `<NAME>` | Edge TLS, HTTP redirected to HTTPS, with the `ROUTE_TIMEOUT` annotation. With cert-manager, its certificate comes from the secret `<NAME>-tls`. |
| Issuer | `letsencrypt` (`CERT_ISSUER`) | `CERT_MANAGER=1` only, when the project has none. Account key in the secret `<CERT_ISSUER>-account-key`. Not in the set: `delete` leaves both. |
| Certificate | `<NAME>-tls` | cert-manager only. For `ROUTE_HOST`; cert-manager writes and renews the secret `<NAME>-tls`. |
| Role, RoleBinding | `<NAME>-tls-router` | cert-manager only. Lets the router's service account (`openshift-ingress/router`) read `<NAME>-tls`, and nothing else. |

On the first deploy with a generated hostname, the public URL is unknown until the Route exists, so the script reads
the Route's host afterwards and sets `PUBLIC_URL` on the Deployment. Later deploys read it from the existing Route.

## A certificate from cert-manager

cert-manager cannot write into a Route. Instead it keeps the certificate in a TLS secret, `<NAME>-tls`, and the Route
names that secret in `spec.tls.externalCertificate`. The router reads the secret itself, so a renewal reaches the
Route with no deploy. The router may read only that one secret: [tls.yaml](tls.yaml) grants it with a Role and
RoleBinding.

The issuer follows the other projects on the cluster: an `Issuer` named `letsencrypt` in the project, Let's Encrypt
production, account key `letsencrypt-account-key`, HTTP-01 through the router with `ingressClassName:
openshift-default`. The deploy creates it from [acme-issuer.yaml](acme-issuer.yaml) when the project has none, and
uses an existing one as it is. For the challenge, cert-manager adds a short-lived Ingress for
`/.well-known/acme-challenge/` on the host, the cluster turns it into a Route, and both are removed once the
challenge passes; that is why no Ingress is left to see afterwards.

Before the first deploy for a host such as `ctx.example.com`:

1. Point the name at the router. `oc get ingresscontroller default -n openshift-ingress-operator -o jsonpath='{.status.domain}'`
   gives the apps domain; a CNAME from the host to any name under it, such as `router-default.<apps domain>`, works.
   Check it with `dig +short ctx.example.com` before deploying.
2. Port 80 must reach the router from the internet, because that is where Let's Encrypt asks for the challenge.
3. Try it once against staging if the host is new, with a separate issuer so the project's production one is untouched:
   `CERT_ISSUER=letsencrypt-staging ACME_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory`. Production
   allows only a few duplicate certificates a week for one name. Browsers reject staging certificates, so delete the
   set before deploying again without those two options. The staging Issuer stays; remove it with
   `oc delete issuer.cert-manager.io/letsencrypt-staging secret/letsencrypt-staging-account-key`.

The deploy makes sure the issuer is ready, applies the Certificate, waits up to five minutes for the certificate, and only then
applies the Route, because the Route is checked against its secret when it is created. When the wait runs out the
script stops and prints the commands that show why; the usual cause is DNS that does not reach the router yet.
Later deploys find the certificate ready and go straight on.

`deploy.sh delete` removes the Certificate before its secret, so cert-manager does not write the secret again. Each
delete and deploy of the same host asks Let's Encrypt for a new certificate, which counts against that weekly limit.

## Applying the templates by hand

`deploy.sh` leaves unset parameters out, so the template defaults apply, and deletes fields that render empty.
`storageClassName: ""` would turn off the default StorageClass, and an empty host, path or certificate must be
absent rather than `""`. The templates add the set's label themselves, so objects applied by hand carry it too. Do
the same by hand:

```bash
oc process --local -f deploy/openshift/app.yaml -p IMAGE=<ref> -p NAME=ctx-audience-app -o yaml | sed '/: ""$/d' | oc apply -f -
```

Without `ROUTE_TLS_SECRET` that leaves `externalCertificate:` with no value on the Route, which a cluster without the
field rejects. `deploy.sh` drops such keys too (the awk in its `render` function); by hand, delete the line or pass
`-p ROUTE_TLS_SECRET=<NAME>-tls` when using [tls.yaml](tls.yaml).

## Changing the volume

`STORAGE_CLASS` and `STORAGE_SIZE` apply only when the claim is created. To change them, stop the pod, delete the
claim, which deletes the room's snapshot with it, and deploy again:

```bash
oc scale deployment/ctx-audience-app --replicas=0
```

```bash
oc delete pvc ctx-audience-app-data
```

```bash
STORAGE_SIZE=5Gi deploy/openshift/deploy.sh
```

## Removing a room

With the script. It lists every object that carries the room's label, asks before deleting, unlinks the pull secret
from the `default` service account, deletes the workloads first and then the volume claim and the secrets:

```bash
PROJECT=ctx-talk deploy/openshift/deploy.sh delete
```

A second room is removed by its name:

```bash
PROJECT=ctx-talk NAME=ctx-rehearsal deploy/openshift/deploy.sh delete
```

Without a terminal, or to skip the question, set `YES=1`:

```bash
PROJECT=ctx-talk YES=1 deploy/openshift/deploy.sh delete
```

By the label alone, with the command a deploy printed. Leave `buildconfig,imagestream` out on a cluster without the
Build capability:

```bash
oc delete deployment,service,route,buildconfig,imagestream,persistentvolumeclaim,secret -n ctx-talk -l ctx-audience-app/deployed-set=ctx-audience-app
```

Either way the volume claim is deleted, and the room's snapshot, event log and exports go with it.

### Keeping the data

`KEEP_DATA=1` deletes everything except the volume claim:

```bash
PROJECT=ctx-talk KEEP_DATA=1 deploy/openshift/deploy.sh delete
```

The claim keeps its label, so it is still part of the set. The next deploy with the same `NAME` in the same project
mounts it again and the room comes back as it was. The secrets are deleted, so that deploy needs `SPEAKER_KEY` again.
To remove the claim later, run `delete` without `KEEP_DATA`.

By the label alone, leave `persistentvolumeclaim` out of the kinds.

### The project

The project stays unless you ask. `DELETE_PROJECT=1` deletes it after the room, but only when the script created the
project and nothing else is left in it: no workloads, services, routes, builds, image streams or volume claims.
Another room in the same project keeps the project, and so does a volume claim kept with `KEEP_DATA=1`:

```bash
PROJECT=ctx-talk DELETE_PROJECT=1 deploy/openshift/deploy.sh delete
```

### A room deployed before the label existed

Its objects have no `ctx-audience-app/deployed-set` label, so `delete` finds nothing and says so. Deploy once more,
which labels everything, and then delete. Or remove it by name, in the room's project:

```bash
oc delete deployment,service,route,pvc -l app=ctx-audience-app
```

```bash
oc delete secret ctx-audience-app-secrets ctx-audience-app-pull --ignore-not-found
```

```bash
oc delete buildconfig,imagestream ctx-audience-app --ignore-not-found
```
