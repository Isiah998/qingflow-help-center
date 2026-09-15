#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

fail() {
  printf 'Jenkins release failed: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' was not found"
}

require_environment() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "required environment variable '$name' is empty"
}

retry_curl() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if curl --connect-timeout 5 --max-time 20 "$@"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

require_command git
require_command node
require_command npm
require_command docker
require_command sha256sum

require_environment OUTLINE_API_TOKEN
require_environment TYPESENSE_HOST
require_environment TYPESENSE_SEARCH_API_KEY
require_environment TYPESENSE_ADMIN_API_KEY
require_environment IMAGE_REPOSITORY
require_environment DEPLOY_TO_K8S

case "${DEPLOY_TO_K8S}" in
  true|false) ;;
  *) fail "DEPLOY_TO_K8S must be either 'true' or 'false'" ;;
esac

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${node_major}" -ge 20 ]] || fail "Node.js 20 or newer is required"

git_revision="${GIT_COMMIT:-$(git rev-parse HEAD)}"
[[ "${git_revision}" =~ ^[0-9a-fA-F]{7,40}$ ]] || fail "GIT_COMMIT is not a Git revision"

export BUILD_COMMIT="${git_revision}"
export DOCS_URL="${DOCS_URL:-https://help-center.qingflow.com}"
export DOCS_BASE_URL="${DOCS_BASE_URL:-/}"
export OUTLINE_URL="${OUTLINE_URL:-https://outline.dev.oalite.com}"
export OUTLINE_COLLECTION="${OUTLINE_COLLECTION:-售后知识库}"
export TYPESENSE_SEARCH_HOST="${TYPESENSE_SEARCH_HOST:-/typesense}"
export TYPESENSE_COLLECTION="${TYPESENSE_COLLECTION:-qingflow_help_docs}"
if [[ -z "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="--max-old-space-size=4096"
fi

printf 'Installing locked dependencies with Node.js %s...\n' "$(node --version)"
npm ci --no-audit --no-fund

printf 'Synchronizing Outline and building one production snapshot...\n'
npm run build:jenkins

[[ -s build/index.html ]] || fail "build/index.html was not generated"
[[ -s .tmp/search-records.json ]] || fail ".tmp/search-records.json was not generated"
search_record_count="$(node -e 'const fs=require("node:fs"); const records=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (!Array.isArray(records)) process.exit(1); process.stdout.write(String(records.length));' .tmp/search-records.json)" \
  || fail ".tmp/search-records.json is not a JSON array"
[[ "${search_record_count}" -gt 0 ]] || fail "search record snapshot is empty"
printf 'Validated %s search records.\n' "${search_record_count}"

content_revision="$(sha256sum .tmp/search-records.json | awk '{print substr($1, 1, 12)}')"
short_revision="${git_revision:0:12}"
if [[ -z "${IMAGE_TAG:-}" ]]; then
  require_environment BUILD_NUMBER
  [[ "${BUILD_NUMBER}" =~ ^[0-9]+$ ]] || fail "BUILD_NUMBER must be numeric"
  image_tag="${short_revision}-${BUILD_NUMBER}-${content_revision}"
else
  image_tag="${IMAGE_TAG}"
fi
[[ "${image_tag}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail "IMAGE_TAG is not a valid container tag"
image_ref="${IMAGE_REPOSITORY%/}:${image_tag}"

printf 'Packaging static site as %s...\n' "${image_ref}"
docker build --pull \
  --file Dockerfile.runtime \
  --build-arg "BUILD_COMMIT=${git_revision}" \
  --build-arg "CONTENT_REVISION=${content_revision}" \
  --tag "${image_ref}" \
  .

docker push "${image_ref}"

printf 'Publishing the search index from the same content snapshot...\n'
npm run search:push

if [[ "${DEPLOY_TO_K8S}" == "true" ]]; then
  require_command kubectl
  require_command curl
  kube_namespace="${KUBE_NAMESPACE:-default}"
  kube_deployment="${KUBE_DEPLOYMENT:-qingflow-help-center}"
  kube_container="${KUBE_CONTAINER:-help-center}"
  rollout_timeout="${KUBE_ROLLOUT_TIMEOUT:-5m}"
  smoke_test_url="${SMOKE_TEST_URL:-http://qingflow-help-center.${kube_namespace}.svc.cluster.local}"

  printf 'Deploying %s to %s/%s...\n' "${image_ref}" "${kube_namespace}" "${kube_deployment}"
  kubectl --namespace "${kube_namespace}" set image \
    "deployment/${kube_deployment}" \
    "${kube_container}=${image_ref}"
  kubectl --namespace "${kube_namespace}" rollout status \
    "deployment/${kube_deployment}" \
    --timeout "${rollout_timeout}"

  printf 'Checking the deployed site and Typesense proxy through %s...\n' "${smoke_test_url}"
  retry_curl --fail --silent --show-error --output /dev/null \
    "${smoke_test_url%/}/healthz" || fail "deployed health check failed"

  search_smoke_response=".tmp/jenkins-search-smoke.json"
  search_smoke_payload="$(node -e 'process.stdout.write(JSON.stringify({searches:[{collection:process.env.TYPESENSE_COLLECTION,q:"审批",query_by:"title,document_title,keywords,tags,search_tokens,content",per_page:1}]}))')"
  retry_curl --fail --silent --show-error \
    --header 'Content-Type: application/json' \
    --header "X-TYPESENSE-API-KEY: ${TYPESENSE_SEARCH_API_KEY}" \
    --data "${search_smoke_payload}" \
    --output "${search_smoke_response}" \
    "${smoke_test_url%/}/typesense/multi_search" || fail "deployed Typesense proxy check failed"
  node -e 'const fs=require("node:fs"); const payload=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const result=payload.results?.[0]; if (!result || result.error || !Number.isFinite(result.found) || result.found < 1) process.exit(1);' \
    "${search_smoke_response}" || fail "Typesense proxy returned an invalid response"
  rm -f "${search_smoke_response}"
fi

printf 'Jenkins release completed. IMAGE_REF=%s CONTENT_REVISION=%s\n' \
  "${image_ref}" "${content_revision}"
