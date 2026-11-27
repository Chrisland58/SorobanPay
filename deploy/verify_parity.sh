#!/usr/bin/env bash
# =============================================================================
# SorobanPay — Deployment Configuration Parity Verification
# =============================================================================
# Verifies that the deployment manifest, backend indexer, and frontend target
# the exact same Stellar network identity and Soroban contract identifier
# before traffic is shifted during a rollout.
#
# Usage:
#   bash deploy/verify_parity.sh [--target-network testnet|mainnet] [--manifest deploy/deployments.json]
#
# Exit codes:
#   0 — All components match on network identity and contract identifier.
#   1 — Mismatch detected, missing configuration, or invalid arguments.
#
# Security:
#   This script NEVER prints secret values (keys, tokens, connection strings).
#   Mismatch reports reference component names and field names only.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_NETWORK="${STELLAR_NETWORK:-testnet}"
MANIFEST_PATH="${MANIFEST_PATH:-${REPO_ROOT}/deploy/deployments.json}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-network)
      TARGET_NETWORK="${2:-}"
      shift 2
      ;;
    --manifest)
      MANIFEST_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$TARGET_NETWORK" in
  testnet|mainnet) ;;
  *)
    echo "ERROR: Invalid target network '${TARGET_NETWORK}'. Allowed: testnet, mainnet." >&2
    exit 1
    ;;
esac

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "ERROR: Deployment manifest not found at '${MANIFEST_PATH}'." >&2
  exit 1
fi

python3 - "$TARGET_NETWORK" "$MANIFEST_PATH" <<'PY'
import json
import os
import sys

target_network = sys.argv[1]
manifest_path = sys.argv[2]

try:
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
except Exception as exc:
    print(f"ERROR: Failed to parse manifest '{manifest_path}': {exc}", file=sys.stderr)
    sys.exit(1)

manifest_entry = manifest.get(target_network, {})
if not isinstance(manifest_entry, dict):
    manifest_entry = {}

components = {
    "manifest": {
        "network": (manifest_entry.get("network") or target_network).strip() if manifest_entry.get("contract_id") else "",
        "contract_id": (manifest_entry.get("contract_id") or "").strip(),
    },
    "backend": {
        "network": (os.environ.get("BACKEND_STELLAR_NETWORK") or os.environ.get("STELLAR_NETWORK") or "").strip(),
        "contract_id": (os.environ.get("BACKEND_CONTRACT_ID") or os.environ.get("CONTRACT_ID") or "").strip(),
    },
    "frontend": {
        "network": (os.environ.get("FRONTEND_STELLAR_NETWORK") or os.environ.get("NEXT_PUBLIC_STELLAR_NETWORK") or "").strip(),
        "contract_id": (os.environ.get("FRONTEND_CONTRACT_ID") or os.environ.get("NEXT_PUBLIC_CONTRACT_ID") or "").strip(),
    },
}

errors = []

for comp, cfg in components.items():
    if not cfg["network"]:
        errors.append(f"MISSING: component '{comp}' is missing network configuration")
    if not cfg["contract_id"]:
        errors.append(f"MISSING: component '{comp}' is missing contract_id configuration")

for field in ("network", "contract_id"):
    values = {comp: cfg[field] for comp, cfg in components.items() if cfg[field]}
    unique_values = set(values.values())
    if len(unique_values) > 1:
        # Group components by their value without printing secret or raw values
        groups = {}
        for comp, val in values.items():
            groups.setdefault(val, []).append(comp)
        # Identify minority/divergent components relative to the largest group
        sorted_groups = sorted(groups.values(), key=len, reverse=True)
        divergent = [comp for grp in sorted_groups[1:] for comp in grp]
        all_comps = ", ".join(sorted(values.keys()))
        div_comps = ", ".join(sorted(divergent))
        errors.append(
            f"MISMATCH [{field}]: configuration parity failed across [{all_comps}]; "
            f"divergent component(s): [{div_comps}]"
        )

if errors:
    print("PARITY CHECK FAILED — blocking deployment before traffic shift:", file=sys.stderr)
    for err in errors:
        print(f"  - {err}", file=sys.stderr)
    sys.exit(1)

print(f"PARITY CHECK PASSED: manifest, backend, and frontend match for network '{target_network}'.")
PY
