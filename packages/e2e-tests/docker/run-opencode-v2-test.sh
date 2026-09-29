#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCKERFILE="$SCRIPT_DIR/opencode-v2/Dockerfile"
IMAGE="${ANTIGRAVITY_OPENCODE2_IMAGE:-antigravity-auth-e2e-opencode2-linux}"
BUN_VERSION="${ANTIGRAVITY_E2E_BUN_VERSION:-1.3.14}"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 2
}

SOURCE_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ ! "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "could not resolve a full checkout SHA" >&2
  exit 2
fi
SOURCE_LABEL="$SOURCE_REVISION"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  SOURCE_LABEL="${SOURCE_LABEL}+dirty"
fi

printf 'Building isolated OpenCode 2 E2E image (Bun %s, checkout %s)...\n' \
  "$BUN_VERSION" "$SOURCE_LABEL"
docker build \
  --build-arg "BUN_VERSION=$BUN_VERSION" \
  --build-arg "SOURCE_REVISION=$SOURCE_REVISION" \
  --file "$DOCKERFILE" \
  --tag "$IMAGE" \
  "$REPO_ROOT"

printf 'Running OpenCode 2 E2E with container networking disabled...\n'
docker run \
  --rm \
  --network none \
  --env ANTIGRAVITY_DOCKER_E2E=1 \
  "$IMAGE"
