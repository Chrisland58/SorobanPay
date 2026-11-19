#!/usr/bin/env bash
# Verify build provenance attestation, source commit, build workflow, and SBOM
# before promoting an artifact or container image to production.
set -euo pipefail

MANIFEST_PATH=""
SBOM_PATH=""
EXPECTED_SHA=""
EXPECTED_WORKFLOW=""
REPO=""
IMAGE_REF=""
VERIFY_GH_ATTESTATION=false

usage() {
  cat << 'EOF'
Usage: verify-image-attestation.sh [OPTIONS]

Options:
  --manifest PATH             Path to artifact-manifest.json
  --sbom PATH                 Path to sbom-inventory.json
  --expected-sha SHA          Expected source commit SHA
  --expected-workflow REF     Expected build workflow reference
  --repo OWNER/REPO           GitHub repository (for gh attestation verify)
  --image IMAGE_REF           Optional container image reference/digest
  --verify-gh-attestation     Run `gh attestation verify` against the subject
  -h, --help                  Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest) MANIFEST_PATH="$2"; shift 2 ;;
    --sbom) SBOM_PATH="$2"; shift 2 ;;
    --expected-sha) EXPECTED_SHA="$2"; shift 2 ;;
    --expected-workflow) EXPECTED_WORKFLOW="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --image) IMAGE_REF="$2"; shift 2 ;;
    --verify-gh-attestation) VERIFY_GH_ATTESTATION=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$MANIFEST_PATH" || ! -f "$MANIFEST_PATH" ]]; then
  echo "ERROR: Missing or unreadable artifact manifest: '${MANIFEST_PATH}'" >&2
  exit 1
fi

if [[ -z "$SBOM_PATH" || ! -f "$SBOM_PATH" ]]; then
  echo "ERROR: Missing or unreadable SBOM inventory: '${SBOM_PATH}'" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required for attestation metadata verification" >&2
  exit 1
fi

# Validate manifest JSON and required fields
if ! jq empty "$MANIFEST_PATH" >/dev/null 2>&1; then
  echo "ERROR: Artifact manifest is not valid JSON: ${MANIFEST_PATH}" >&2
  exit 1
fi

ACTUAL_SHA=$(jq -r '.git_sha // empty' "$MANIFEST_PATH")
ACTUAL_WORKFLOW=$(jq -r '.build_workflow // empty' "$MANIFEST_PATH")
ACTUAL_RUN_ID=$(jq -r '.workflow_run_id // empty' "$MANIFEST_PATH")
ACTUAL_INVENTORY=$(jq -r '.dependency_inventory // empty' "$MANIFEST_PATH")

if [[ -z "$ACTUAL_SHA" || -z "$ACTUAL_WORKFLOW" || -z "$ACTUAL_RUN_ID" || -z "$ACTUAL_INVENTORY" ]]; then
  echo "ERROR: Artifact manifest missing required provenance fields (git_sha, build_workflow, workflow_run_id, dependency_inventory)" >&2
  exit 1
fi

if [[ -n "$EXPECTED_SHA" && "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR: Source commit mismatch: expected '${EXPECTED_SHA}', got '${ACTUAL_SHA}'" >&2
  exit 1
fi

if [[ -n "$EXPECTED_WORKFLOW" && "$ACTUAL_WORKFLOW" != "$EXPECTED_WORKFLOW" ]]; then
  echo "ERROR: Untrusted build workflow: expected '${EXPECTED_WORKFLOW}', got '${ACTUAL_WORKFLOW}'" >&2
  exit 1
fi

# Validate SBOM JSON and non-empty dependency inventory
if ! jq empty "$SBOM_PATH" >/dev/null 2>&1; then
  echo "ERROR: SBOM inventory is not valid JSON: ${SBOM_PATH}" >&2
  exit 1
fi

COMPONENT_COUNT=$(jq -r '.components | if type == "array" then length else 0 end' "$SBOM_PATH")
if [[ "$COMPONENT_COUNT" -le 0 ]]; then
  echo "ERROR: SBOM dependency inventory is empty or missing components" >&2
  exit 1
fi

# Verify cryptographic provenance attestation via GitHub CLI when enabled
if [[ "$VERIFY_GH_ATTESTATION" == "true" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: gh CLI is required for --verify-gh-attestation" >&2
    exit 1
  fi
  if [[ -z "$REPO" ]]; then
    echo "ERROR: --repo is required when --verify-gh-attestation is enabled" >&2
    exit 1
  fi

  SUBJECT="${IMAGE_REF:-$MANIFEST_PATH}"
  if [[ -n "$IMAGE_REF" ]]; then
    gh attestation verify "oci://${IMAGE_REF}" --repo "$REPO"
  else
    gh attestation verify "$SUBJECT" --repo "$REPO"
  fi
fi

echo "✅ Provenance attestation and SBOM verified (sha=${ACTUAL_SHA}, workflow=${ACTUAL_WORKFLOW}, components=${COMPONENT_COUNT})"
