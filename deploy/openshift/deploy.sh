#!/usr/bin/env bash
# Deploy Context Window Live to OpenShift, or remove a deployment.
#
#   deploy/openshift/deploy.sh           deploy, or deploy again
#   deploy/openshift/deploy.sh delete    remove the deployed set of PROJECT and NAME
#
# OPTIONS
# Every option is an environment variable; unset ones take the defaults here and in app.yaml.
#   PROJECT         Project (namespace) to deploy into. Default: the current one (oc project -q). Created when
#                   it does not exist. NAMESPACE is accepted as an alias.
#   NAME            Name of the Deployment, Service, Route, volume claim, ImageStream and BuildConfig, and the
#                   prefix of the secrets. Default ctx-audience-app. Two names give two independent rooms.
#   ROUTE_HOST      Hostname of the Route. Default: the cluster's generated <NAME>-<PROJECT>.<apps domain>.
#                   A name outside the apps domain needs a DNS record to the router and, unless the router's
#                   wildcard certificate covers it, ROUTE_TLS_CERT_FILE and ROUTE_TLS_KEY_FILE.
#   ROUTE_PATH      Path prefix, e.g. /talk, to share a hostname with other apps. Default: the whole host.
#                   The app serves itself under the prefix, so the join URL becomes https://<host>/talk/session/main.
#   ROUTE_TIMEOUT   HAProxy timeout for the Route. Default 1h, because sockets idle between phases.
#   ROUTE_TLS_CERT_FILE, ROUTE_TLS_KEY_FILE, ROUTE_TLS_CA_FILE
#                   PEM files for the Route's edge TLS. Default: the router's own certificate.
#   CERT_MANAGER    Set to 1 to get the Route's certificate for ROUTE_HOST from cert-manager, the way the cluster's
#                   other projects do: the project's Let's Encrypt Issuer answers HTTP-01 through the router
#                   (ingressClassName openshift-default), so ROUTE_HOST's DNS record must already point at the
#                   router. cert-manager keeps the certificate in the secret <NAME>-tls and renews it there; the
#                   Route reads it from that secret. Needs cert-manager on the cluster and a Route API with
#                   spec.tls.externalCertificate. Not with ROUTE_TLS_CERT_FILE.
#   CERT_ISSUER     The issuer to use. Default letsencrypt. With the default kind, an Issuer of that name is
#                   created in PROJECT from acme-issuer.yaml when there is none, and used as it is when there is.
#   CERT_ISSUER_KIND
#                   Issuer (default) or ClusterIssuer. A ClusterIssuer is never created, only used.
#   ACME_SERVER     ACME directory of an Issuer the script creates. Default Let's Encrypt production; for trial
#                   runs, staging (https://acme-staging-v02.api.letsencrypt.org/directory), which browsers reject.
#   PUBLIC_URL      URL the QR code points to. Default https://<route host><ROUTE_PATH>. Set it when another
#                   name (a CDN, a short-link domain) fronts the Route.
#   SHORT_URL       Text the lobby prints under the QR code instead of the site root, e.g. a short link that
#                   redirects to the room. Display only: the QR code, Route and certificate are unchanged.
#   NOTES_READONLY  1 (default) turns saving speaker notes off on the cluster; the notes view still shows the notes
#                   built into the image. 0 saves into the container's copy, which the next deploy or restart replaces.
#   STORAGE_CLASS   StorageClass of the data volume. Default: the cluster's default class.
#   STORAGE_SIZE    Size of the data volume. Default 1Gi.
#                   Both are fixed once the claim exists: delete the PVC to change them (the room's snapshot goes with it).
#   CPU_REQUEST, MEMORY_REQUEST, CPU_LIMIT, MEMORY_LIMIT
#                   Container resources. Defaults 100m, 128Mi, 1, 512Mi.
#   IMAGE           Build locally with podman and push to this repository instead of building in-cluster (below).
#   PLATFORM        Platform of the local build. Default linux/amd64; linux/arm64 for Arm nodes.
#   TAG             Image tag. Default: the git short SHA, plus -dirty when the tree has uncommitted changes.
#   REFRESH_SECRET  Set to 1 to rebuild the secret from the environment and .env. By default it is created once
#                   and kept, so a new SPEAKER_KEY or model setting needs this.
#   YES             With delete: set to 1 to delete without the confirmation prompt.
#   KEEP_DATA       With delete: set to 1 to keep the volume claim, and with it the room's snapshot, event log
#                   and exports. The next deploy of the same NAME in the same project mounts it again.
#   DELETE_PROJECT  With delete: set to 1 to delete the project as well. Only a project this script created is
#                   deleted, and only once it holds nothing else.
#
# THE DEPLOYED SET
# Every object a deploy creates carries the label ctx-audience-app/deployed-set=<NAME>. That is the two secrets,
# the build objects and the builds they start, the volume claim, the Deployment with its ReplicaSets and pods, the
# Service and the Route, and with cert-manager the Certificate, its secret, and the router's Role and RoleBinding.
# The project's Issuer is not in the set: it is shared like the other projects' issuers, and delete leaves it. A deploy ends by printing the label with the commands that list and remove the set.
# `delete` lists what carries the label, asks, unlinks the pull secret from the default service account and
# deletes the set. That includes the volume claim (the room's snapshot, event log and exports) unless KEEP_DATA=1.
# A project takes no labels from a project admin, so a project this script creates is marked in its description.
#
# SECRETS
# The secret holds SPEAKER_KEY (required) and the live-model settings from .env.example (LLM_PROVIDER, LLM_MODEL,
# LLM_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY, LLM_BASE_URL, LLM_EFFORT, LLM_MAX_TOKENS, LLM_TIMEOUT_MS): the
# environment first, then .env. The deployment options above are read from the environment only.
#
# IMAGES
# Two ways to get an image:
#   1. In-cluster build (default): needs the cluster's Build capability (the `builder` service account exists).
#        deploy/openshift/deploy.sh
#   2. Local build with podman, pushed to a registry you can reach (works on every cluster):
#        IMAGE=quay.io/<you>/ctx-audience-app deploy/openshift/deploy.sh
#      Run `podman login` to the registry first; if the repository is private the script creates a pull secret
#      from podman's auth file. A tag on IMAGE is ignored; TAG overrides the computed one.
# Every image is tagged with the git short SHA (plus -dirty when the working tree has uncommitted changes), so each
# deploy points the Deployment at a new image reference and the cluster must pull it. `latest` is updated as well.
#
# EXAMPLES
#   PROJECT=ctx-talk deploy/openshift/deploy.sh
#   PROJECT=talks NAME=ctx-rehearsal ROUTE_HOST=talks.example.com ROUTE_PATH=/ctx STORAGE_CLASS=gp3-csi deploy/openshift/deploy.sh
#   PROJECT=ctx-talk ROUTE_HOST=ctx.example.com CERT_MANAGER=1 deploy/openshift/deploy.sh
#   PROJECT=ctx-talk deploy/openshift/deploy.sh delete
#   PROJECT=ctx-talk KEEP_DATA=1 deploy/openshift/deploy.sh delete
#
# CHANGING THIS SCRIPT
# It reads top to bottom in five parts, each under a "Part" heading:
#   1. Action and target   which action, which project, which name
#   2. The deployed set    the label, the kinds of object in a set, and the helpers both actions share
#   3. delete              everything `deploy.sh delete` does, then exit
#   4. deploy              project, secret, image, objects, rollout
#   5. Report              the URLs, the label and how to remove the set
# To have a deploy create another object: produce its manifest and pipe it to apply_to_set (part 2), which adds
#   the label and applies it. If its kind is not in the kinds lists of part 2, add it there. Otherwise neither
#   delete nor the printed commands will see it.
# To rename the label: change SET_LABEL_KEY in part 2, and the same key in app.yaml (twice: the Template's labels
#   and the Deployment's pod template), tls.yaml (twice: the Template's labels and the Certificate's
#   secretTemplate) and build.yaml (once). A deploy stops if a template does not name it.
#   Objects labelled under the old key are not found under the new one, so delete existing rooms first.
# To add an option: read it as ${VAR:-default}, and describe it under OPTIONS above and in README.md.
# To check a change without a cluster: `bash -n deploy/openshift/deploy.sh` checks the syntax, and
#   `oc process --local -f deploy/openshift/app.yaml -p IMAGE=x -o yaml` renders a template offline.
# The script must run on bash 3.2, which is what macOS ships: no associative arrays, no ${var,,}, no mapfile.
set -euo pipefail
cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------------------------------------------
# Part 1. Action and target
# ---------------------------------------------------------------------------------------------------------------
# The action is the only positional argument, so an exported variable can never turn a deploy into a delete.
ACTION=${1:-deploy}
case "$ACTION" in
  deploy|delete) ;;
  *) echo "usage: deploy/openshift/deploy.sh [delete]   (options are environment variables; see the top of the script)" >&2; exit 2 ;;
esac

PROJECT=${PROJECT:-${NAMESPACE:-$(oc project -q)}}
NAME=${NAME:-ctx-audience-app}

# ---------------------------------------------------------------------------------------------------------------
# Part 2. The deployed set
# ---------------------------------------------------------------------------------------------------------------
# One deploy's objects all carry one label, so they can be listed and removed together. The key is fixed and the
# value is NAME, so two names in one project are two sets. Every valid NAME is also a valid label value.
SET_LABEL_KEY="ctx-audience-app/deployed-set"
SET_LABEL="$SET_LABEL_KEY=$NAME"

# The kinds of object a deploy creates directly, grouped by how delete treats them. What these objects own
# (ReplicaSets, pods, builds) is not listed: the cluster deletes it with its owner.
WORKLOAD_KINDS="deployment,service,route,role,rolebinding"   # deleted first, so the pod is gone before its volume
BUILD_KINDS="buildconfig,imagestream"       # deleted with the workloads; see workload_kinds
# Deleted with the workloads, so the Certificate is gone before its secret and cert-manager cannot write it again.
TLS_KINDS="certificate.cert-manager.io"
DATA_KINDS="persistentvolumeclaim"          # the room's data; KEEP_DATA=1 keeps it
SECRET_KINDS="secret"                       # <NAME>-secrets and <NAME>-pull

# The workload kinds this cluster knows, as one comma list. The build kinds exist only on a cluster with the
# Build capability and the TLS kinds only where cert-manager is installed, and naming a kind the cluster does not
# have makes `oc get` and `oc delete` fail for the whole list. So each group is added only when asking for it
# works. Call it after `oc` is bound to PROJECT.
workload_kinds() {
  local kinds=$WORKLOAD_KINDS
  if oc get "$BUILD_KINDS" -l "$SET_LABEL" -o name >/dev/null 2>&1; then kinds="$kinds,$BUILD_KINDS"; fi
  if oc get "$TLS_KINDS" -l "$SET_LABEL" -o name >/dev/null 2>&1; then kinds="$kinds,$TLS_KINDS"; fi
  printf '%s' "$kinds"
}

# A project is the one thing a deploy may create that cannot carry the label: a project admin can set a project's
# description when creating it and nothing else. So the description carries this mark, and delete looks for it
# before it will remove a project.
PROJECT_MARK="Created by ctx-audience-app deploy.sh"
project_is_ours() {
  case "$(command oc get project "$PROJECT" -o jsonpath='{.metadata.annotations.openshift\.io/description}' 2>/dev/null || true)" in
    *"$PROJECT_MARK"*) return 0 ;; *) return 1 ;;
  esac
}

# Every object a deploy creates goes through here: the manifest on stdin, one object or a list, gets the set's
# label and is applied. `oc label --local` edits the manifest without contacting the cluster, so an object carries
# the label from the moment it exists. --overwrite makes a manifest that already names the label, as the templates
# do, pass unchanged.
# The output must be JSON. With `-o yaml`, `oc label` prints the objects of a list one after another with no
# `---` between them, and `oc apply` then reads that as one document and applies only the last object. JSON
# objects one after another are read as a stream, each in turn.
apply_to_set() { oc label --local -f - "$SET_LABEL" --overwrite -o json | oc apply -f -; }

# Prints a list of object names, indented, for the messages below.
indented() { printf '%s\n' "$1" | sed 's/^/  /'; }

# ---------------------------------------------------------------------------------------------------------------
# Part 3. delete
# ---------------------------------------------------------------------------------------------------------------
if [ "$ACTION" = delete ]; then
  # A missing project means there is nothing to remove. A delete never creates one.
  command oc get project "$PROJECT" >/dev/null 2>&1 || { echo "project $PROJECT not found: nothing to delete"; exit 0; }
  # From here on every oc call targets PROJECT.
  oc() { command oc -n "$PROJECT" "$@"; }

  # 3a. What carries the label. `-o name` gives one "kind/name" per line.
  workloads=$(workload_kinds)
  found=$(oc get "$workloads,$DATA_KINDS,$SECRET_KINDS" -l "$SET_LABEL" -o name)

  # 3b. What to keep. KEEP_DATA=1 takes the volume claim off the list. The claim keeps its label, so a later
  # delete without KEEP_DATA still finds it, and a later deploy of the same NAME mounts it again.
  data_pattern="^(${DATA_KINDS//,/|})/"
  kept=""
  if [ "${KEEP_DATA:-0}" = 1 ]; then
    kept=$(printf '%s\n' "$found" | grep -E "$data_pattern" || true)
    found=$(printf '%s\n' "$found" | grep -Ev "$data_pattern" || true)
  fi

  # 3c. Whether the project goes too. It has to be asked for, the project has to be one this script created, and
  # a kept volume claim keeps the project it lives in. Whether the project is empty is checked after the delete.
  ours=0; if project_is_ours; then ours=1; fi
  drop_project=0
  if [ "${DELETE_PROJECT:-0}" = 1 ]; then
    if [ "$ours" != 1 ]; then echo "project $PROJECT was not created by this script: it is kept"
    elif [ -n "$kept" ]; then echo "project $PROJECT is kept: KEEP_DATA=1 leaves the volume claim in it"
    else drop_project=1; fi
  fi

  # 3d. Nothing to do. A deployment made before the label existed has no label, so say that rather than nothing.
  if [ -z "$found" ] && [ "$drop_project" = 0 ]; then
    echo "nothing to delete in project $PROJECT carries the label $SET_LABEL"
    if [ -n "$kept" ]; then echo "kept (KEEP_DATA=1):"; indented "$kept"; fi
    if [ -z "$kept" ] && oc get "deployment/$NAME" >/dev/null 2>&1; then
      echo "deployment/$NAME exists without it, so it was deployed before the label existed."
      echo "Deploy once more to label the set, or remove it by name: see deploy/openshift/README.md."
    fi
    exit 0
  fi

  # 3e. Say what will happen, then ask. Without a terminal there is nobody to ask, so YES=1 is required.
  echo "project: $PROJECT"
  echo "label: $SET_LABEL"
  if [ -n "$found" ]; then echo "to delete:"; indented "$found"; fi
  if [ -n "$kept" ]; then
    echo "kept (KEEP_DATA=1):"; indented "$kept"
    echo "It holds the room's snapshot, event log and exports. The next deploy of $NAME here mounts it again."
  elif printf '%s\n' "$found" | grep -Eq "$data_pattern"; then
    echo "The volume claim holds the room's snapshot, event log and exports. KEEP_DATA=1 keeps it."
  fi
  [ "$drop_project" = 0 ] || echo "and project $PROJECT itself, if nothing else is left in it"
  if [ "${YES:-0}" != 1 ]; then
    [ -t 0 ] || { echo "not a terminal: set YES=1 to delete without asking" >&2; exit 1; }
    # End of input counts as no.
    read -r -p "delete? [y/N] " answer || answer=""
    case "$answer" in y|Y|yes|Yes|YES) ;; *) echo "nothing deleted"; exit 0 ;; esac
  fi

  # 3f. Delete the set.
  if [ -n "$found" ]; then
    # A deploy links the pull secret to the default service account; take the link away with the secret.
    case "$found" in *"secret/$NAME-pull"*) oc secrets unlink default "$NAME-pull" >/dev/null 2>&1 || true ;; esac
    # Workloads first and in the foreground: the command returns once the ReplicaSets, pods and builds are gone,
    # so the pod has let go of the volume before the claim is deleted. The timeout stops a stuck delete from
    # hanging the script; whatever was not deleted still carries the label, so the delete can be run again.
    oc delete "$workloads" -l "$SET_LABEL" --cascade=foreground --timeout=180s
    if [ -n "$kept" ] || [ "${KEEP_DATA:-0}" = 1 ]; then oc delete "$SECRET_KINDS" -l "$SET_LABEL" --timeout=180s
    else oc delete "$DATA_KINDS,$SECRET_KINDS" -l "$SET_LABEL" --timeout=180s; fi
  fi
  if [ -n "$kept" ]; then
    echo "kept: $(printf '%s' "$kept" | tr '\n' ' ')"
    echo "remove it later with: PROJECT=$PROJECT NAME=$NAME deploy/openshift/deploy.sh delete"
  fi

  # 3g. The project, when asked for. It goes only if nothing is left in it, so a second room, or anything else
  # someone put there, keeps it. `all` covers workloads, services, routes, builds and image streams.
  if [ "$drop_project" = 1 ]; then
    left=$(oc get all,persistentvolumeclaim -o name 2>/dev/null || true)
    if [ -n "$left" ]; then
      echo "project $PROJECT is kept: it still holds"; indented "$left"
    else
      command oc delete project "$PROJECT"
    fi
  elif [ "$ours" = 1 ]; then
    echo "project $PROJECT was created by this script and is kept. DELETE_PROJECT=1 deletes it too, once it holds nothing else."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------------------------------------------
# Part 4. deploy
# ---------------------------------------------------------------------------------------------------------------
PLATFORM=${PLATFORM:-linux/amd64}
ROUTE_HOST=${ROUTE_HOST:-}
ROUTE_PATH=${ROUTE_PATH:-}
PUBLIC_URL=${PUBLIC_URL:-}
# The path is /talk, never talk or /talk/; a bare / means the whole host.
if [ -n "$ROUTE_PATH" ]; then ROUTE_PATH="/${ROUTE_PATH#/}"; ROUTE_PATH=${ROUTE_PATH%/}; fi
# cert-manager options. Check them before anything is created.
CERT_MANAGER=${CERT_MANAGER:-0}
CERT_ISSUER=${CERT_ISSUER:-letsencrypt}
CERT_ISSUER_KIND=${CERT_ISSUER_KIND:-Issuer}
if [ "$CERT_MANAGER" = 1 ]; then
  [ -n "$ROUTE_HOST" ] || { echo "CERT_MANAGER=1 needs ROUTE_HOST: the certificate is for that name" >&2; exit 1; }
  [ -z "${ROUTE_TLS_CERT_FILE:-}" ] || { echo "use either CERT_MANAGER=1 or ROUTE_TLS_CERT_FILE, not both" >&2; exit 1; }
  case "$CERT_ISSUER_KIND" in ClusterIssuer|Issuer) ;; *) echo "CERT_ISSUER_KIND is ClusterIssuer or Issuer" >&2; exit 1 ;; esac
  # api-resources exits non-zero when any aggregated API fails discovery (metrics.k8s.io often does), while still
  # listing the rest; under pipefail that read as "no cert-manager". So keep its output and ignore its status.
  cm_resources=$(command oc api-resources --api-group=cert-manager.io -o name 2>&1 || true)
  case "$cm_resources" in
    *certificates.cert-manager.io*) ;;
    *) echo "cert-manager's Certificate API is not visible on this cluster. oc api-resources said:" >&2
       indented "$cm_resources" >&2; exit 1 ;;
  esac
  command oc explain route.spec.tls.externalCertificate >/dev/null 2>&1 \
    || { echo "this cluster's Route API has no spec.tls.externalCertificate, which the Route needs to read cert-manager's secret" >&2; exit 1; }
fi
if [ -z "${TAG:-}" ]; then
  TAG=$(git rev-parse --short HEAD)
  [ -z "$(git status --porcelain --untracked-files=no)" ] || TAG="$TAG-dirty"
fi

# The templates name the label as well: in the Template's labels, so objects applied by hand carry it, and in the
# Deployment's pod template, which is how ReplicaSets and pods get it. Stop if a template and SET_LABEL_KEY differ.
for f in deploy/openshift/app.yaml deploy/openshift/build.yaml deploy/openshift/tls.yaml; do
  grep -qF "  $SET_LABEL_KEY: " "$f" || { echo "$f does not name the label $SET_LABEL_KEY: keep it in step with deploy.sh" >&2; exit 1; }
done

# 4a. The project. Created when missing, and marked as this script's (see PROJECT_MARK).
oc get project "$PROJECT" >/dev/null 2>&1 || {
  oc new-project "$PROJECT" --skip-config-write --description="Context Window Live. $PROJECT_MARK." >/dev/null
  echo "created project $PROJECT"
}
# From here on every oc call targets PROJECT.
oc() { command oc -n "$PROJECT" "$@"; }
echo "project: $PROJECT"
echo "name: $NAME"
echo "tag: $TAG"
echo "label: $SET_LABEL"

# 4b. The secret. Created from the environment (or .env) on the first deploy and kept; REFRESH_SECRET=1 rewrites it.
SECRET_KEYS="SPEAKER_KEY LLM_PROVIDER LLM_MODEL LLM_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY LLM_BASE_URL LLM_EFFORT LLM_MAX_TOKENS LLM_TIMEOUT_MS"
# A secret value: the environment first, then .env, sourced in a subshell so it cannot change this script's options.
secret_value() {
  if [ -n "${!1:-}" ]; then printf '%s' "${!1}"
  else ( if [ -f .env ]; then set -a; . ./.env; set +a; fi; printf '%s' "${!1:-}" ); fi
}
if [ "${REFRESH_SECRET:-0}" = 1 ] || ! oc get secret "$NAME-secrets" >/dev/null 2>&1; then
  case "$(secret_value SPEAKER_KEY)" in
    ""|CHOOSE-A-SECRET|change-me) echo "set SPEAKER_KEY to a secret of your own (in the environment or .env); the pod refuses to start with the placeholder" >&2; exit 1 ;;
  esac
  literals=()
  for k in $SECRET_KEYS; do literals+=("--from-literal=$k=$(secret_value "$k")"); done
  # --dry-run=client writes the manifest instead of creating the secret, so it can be labelled and applied.
  oc create secret generic "$NAME-secrets" "${literals[@]}" --dry-run=client -o yaml | apply_to_set
fi
# A kept secret is not re-applied, so label it here. This is what brings a secret from a deploy made before the
# label existed into the set.
oc label secret "$NAME-secrets" "$SET_LABEL" --overwrite >/dev/null

# 4c. The image: a local build pushed to a registry, or a build in the cluster.
if [ -n "${IMAGE:-}" ]; then
  # IMAGE names the repository; strip any tag the caller left on it.
  REPO=${IMAGE%%@*}
  case "${REPO##*/}" in *:*) REPO=${REPO%:*} ;; esac
  IMAGE="$REPO:$TAG"
  echo "building $IMAGE for $PLATFORM with podman"
  podman build --platform "$PLATFORM" -t "$IMAGE" -t "$REPO:latest" .
  podman push "$IMAGE"
  podman push "$REPO:latest"
  # Private repository? Give the pod podman's credentials for it.
  AUTH=${REGISTRY_AUTH_FILE:-${XDG_RUNTIME_DIR:-$HOME/.config}/containers/auth.json}
  [ -f "$AUTH" ] || AUTH="$HOME/.config/containers/auth.json"
  if [ -f "$AUTH" ]; then
    oc create secret generic "$NAME-pull" --from-file=.dockerconfigjson="$AUTH" \
      --type=kubernetes.io/dockerconfigjson --dry-run=client -o yaml | apply_to_set
    # The link is a change to the default service account, not an object of the set. delete undoes it.
    oc secrets link default "$NAME-pull" --for=pull
  fi
else
  # Binary build: streams the working tree (minus .dockerignore) to the cluster and builds the Dockerfile there.
  # The BuildConfig writes <NAME>:latest; the result is then tagged with the SHA for the Deployment.
  # Each build copies the BuildConfig's labels, so the builds are in the set without being applied here.
  oc process --local -f deploy/openshift/build.yaml -p "NAME=$NAME" -o yaml | apply_to_set
  oc start-build "$NAME" --from-dir=. --follow
  oc tag "$NAME:latest" "$NAME:$TAG"
  IMAGE="image-registry.openshift-image-registry.svc:5000/$PROJECT/$NAME:$TAG"
fi

# 4d. The certificate, with cert-manager. The Route is checked against its secret when it is applied, so the
# certificate has to be issued first. On a redeploy it already is and the wait returns at once.
if [ "$CERT_MANAGER" = 1 ]; then
  if [ "$CERT_ISSUER_KIND" = Issuer ]; then
    # The project's issuer, shared like the other projects' ones: created once, never changed or labelled here.
    if ! oc get "issuer.cert-manager.io/$CERT_ISSUER" >/dev/null 2>&1; then
      acme=(-p "CERT_ISSUER=$CERT_ISSUER")
      [ -z "${ACME_SERVER:-}" ] || acme+=(-p "ACME_SERVER=$ACME_SERVER")
      oc process --local -f deploy/openshift/acme-issuer.yaml "${acme[@]}" -o yaml | oc apply -f -
    fi
    oc wait --for=condition=Ready "issuer.cert-manager.io/$CERT_ISSUER" --timeout=120s \
      || { echo "issuer $CERT_ISSUER is not ready: oc describe issuer.cert-manager.io/$CERT_ISSUER -n $PROJECT" >&2; exit 1; }
  else
    command oc get "clusterissuer.cert-manager.io/$CERT_ISSUER" >/dev/null 2>&1 \
      || { echo "ClusterIssuer $CERT_ISSUER not found: oc get clusterissuers" >&2; exit 1; }
  fi
  echo "certificate: $ROUTE_HOST from $CERT_ISSUER_KIND/$CERT_ISSUER"
  oc process --local -f deploy/openshift/tls.yaml -p "NAME=$NAME" -p "ROUTE_HOST=$ROUTE_HOST" \
    -p "CERT_ISSUER=$CERT_ISSUER" -p "CERT_ISSUER_KIND=$CERT_ISSUER_KIND" -o yaml | apply_to_set
  # HTTP-01 needs the DNS record to reach the router; a first issue usually takes under a minute.
  oc wait --for=condition=Ready "certificate.cert-manager.io/$NAME-tls" --timeout=300s || {
    echo "certificate $NAME-tls was not issued. See why with:" >&2
    echo "  oc describe certificate.cert-manager.io/$NAME-tls -n $PROJECT" >&2
    echo "  oc get certificaterequests,orders,challenges -n $PROJECT" >&2
    exit 1
  }
fi

# 4e. The runtime objects from app.yaml: volume claim, Deployment, Service, Route.
# The QR code needs the public URL. It is known up front from PUBLIC_URL, ROUTE_HOST or an existing Route; on the
# first deploy with a generated hostname it is set once the Route exists.
if [ -z "$PUBLIC_URL" ]; then
  HOST=${ROUTE_HOST:-$(oc get route "$NAME" -o jsonpath='{.spec.host}' 2>/dev/null || true)}
  [ -z "$HOST" ] || PUBLIC_URL="https://$HOST$ROUTE_PATH"
fi

# Parameters left unset are not passed, so app.yaml's defaults apply. Parameters that are empty by design are then
# dropped from the rendered objects instead of being sent as "": storageClassName: "" would turn off the default
# StorageClass, and a host, path or certificate is unset only when the field is absent.
# A key whose only child was dropped is left with no value (`externalCertificate:`, which reads as null), and a
# cluster that does not know the field rejects it even as null, so the awk drops a value-less key that has no more
# deeply indented line or list item under it.
render() {
  local f=$1; shift
  oc process --local -f "$f" -o yaml "$@" | sed '/: ""$/d' | awk '
    function ind(s) { match(s, /^ */); return RLENGTH }
    {
      if (held != "") {
        t = $0; sub(/^ */, "", t)
        if (ind($0) > ind(held) || (ind($0) == ind(held) && t ~ /^- /)) print held
        held = ""
      }
      if ($0 ~ /^ *[A-Za-z0-9_.-]+:$/) { held = $0; next }
      print
    }'
}
params=(-p "NAME=$NAME" -p "IMAGE=$IMAGE")
[ "$CERT_MANAGER" = 0 ] || params+=(-p "ROUTE_TLS_SECRET=$NAME-tls")
for p in PUBLIC_URL SHORT_URL ROUTE_HOST ROUTE_PATH ROUTE_TIMEOUT NOTES_READONLY STORAGE_CLASS STORAGE_SIZE CPU_REQUEST MEMORY_REQUEST CPU_LIMIT MEMORY_LIMIT; do
  [ -z "${!p:-}" ] || params+=(-p "$p=${!p}")
done
if [ -n "${ROUTE_TLS_CERT_FILE:-}" ]; then
  : "${ROUTE_TLS_KEY_FILE:?ROUTE_TLS_KEY_FILE goes with ROUTE_TLS_CERT_FILE}"
  params+=(-p "ROUTE_TLS_CERTIFICATE=$(cat "$ROUTE_TLS_CERT_FILE")" -p "ROUTE_TLS_KEY=$(cat "$ROUTE_TLS_KEY_FILE")")
  [ -z "${ROUTE_TLS_CA_FILE:-}" ] || params+=(-p "ROUTE_TLS_CA_CERTIFICATE=$(cat "$ROUTE_TLS_CA_FILE")")
fi
# A volume claim kept by an earlier `KEEP_DATA=1 delete` is still there under the same name, so the new
# Deployment mounts it and the room comes back as it was.
render deploy/openshift/app.yaml "${params[@]}" | apply_to_set

# 4f. Roll out.
if [ -z "$PUBLIC_URL" ]; then
  PUBLIC_URL="https://$(oc get route "$NAME" -o jsonpath='{.spec.host}')$ROUTE_PATH"
  oc set env "deployment/$NAME" PUBLIC_URL="$PUBLIC_URL"
fi
oc rollout restart "deployment/$NAME"
oc rollout status "deployment/$NAME" --timeout=180s

# ---------------------------------------------------------------------------------------------------------------
# Part 5. Report: where the room is, what identifies the set, and how to remove it
# ---------------------------------------------------------------------------------------------------------------
# The kinds in the printed commands are the ones this cluster knows, so the commands can be pasted as they are.
kinds="$(workload_kinds),$DATA_KINDS,$SECRET_KINDS"
echo
echo "participants : $PUBLIC_URL/session/main"
echo "display      : $PUBLIC_URL/session/main/display"
echo "control      : $PUBLIC_URL/session/main/control?key=<SPEAKER_KEY>"
echo "facilitator  : $PUBLIC_URL/session/main/facilitator?key=<SPEAKER_KEY>"
echo
echo "label        : $SET_LABEL"
echo "               Every object this deploy created in project $PROJECT carries it."
echo "list         : oc get $kinds -n $PROJECT -l $SET_LABEL"
echo "remove       : oc delete $kinds -n $PROJECT -l $SET_LABEL"
echo "               or: PROJECT=$PROJECT NAME=$NAME deploy/openshift/deploy.sh delete"
echo "               The script lists the set, asks first and unlinks the pull secret."
echo "               Both delete the volume claim, and with it the room's snapshot, event log and exports."
echo "               With the script, KEEP_DATA=1 keeps the volume claim."
if project_is_ours; then
  echo "project      : $PROJECT was created by this script. With delete, DELETE_PROJECT=1 removes it too once it holds nothing else."
fi
