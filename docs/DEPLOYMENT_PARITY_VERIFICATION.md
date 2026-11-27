# Deployment Configuration Parity Verification

`deploy/verify_parity.sh` enforces configuration parity across the deployment manifest (`deploy/deployments.json`), the backend indexer, and the frontend before traffic is shifted during a rollout.

## What It Checks

For a target network (`testnet` or `mainnet`), the check compares:

1. **Network identity** (`network`)
2. **Contract identifier** (`contract_id`)

across three components:

- **`manifest`**: `deploy/deployments.json` entry for `--target-network`
- **`backend`**: `BACKEND_STELLAR_NETWORK` (or `STELLAR_NETWORK`) and `BACKEND_CONTRACT_ID` (or `CONTRACT_ID`)
- **`frontend`**: `FRONTEND_STELLAR_NETWORK` (or `NEXT_PUBLIC_STELLAR_NETWORK`) and `FRONTEND_CONTRACT_ID` (or `NEXT_PUBLIC_CONTRACT_ID`)

## Usage

Run the parity check before shifting traffic in a deployment pipeline:

```bash
bash deploy/verify_parity.sh --target-network testnet --manifest deploy/deployments.json
```

- Exit `0`: All components match on network identity and contract identifier.
- Exit `1`: Missing configuration, invalid network, or mismatch detected. Rollout is blocked before traffic is shifted.

## Security Guarantees

- Mismatch and missing-configuration diagnostics report **component names** (`manifest`, `backend`, `frontend`) and **field names** (`network`, `contract_id`) only.
- Secret values (such as `STELLAR_SECRET_KEY`, `DATABASE_URL`, `JWT_SECRET`, or API keys) are never logged or echoed.

## Automated Tests

Offline tests covering matching configurations, deliberate mismatch rollout blocking, network mismatches, secret redaction, and boundary cases are in `deploy/test_verify_parity.sh`:

```bash
bash deploy/test_verify_parity.sh
```

This suite is also executed automatically in CI via `.github/workflows/deployment-smoke.yml`.
