/**
 * contractUpgradeChecklistService.ts
 *
 * Repeatable verification checklist and validation engine for SorobanPay
 * Smart Contract upgrades (#1630).
 *
 * Separates procedures into four mandatory stages:
 * 1. Build & Artifact Identity
 * 2. Multi-Party Review (Storage compatibility, Authorization, Event Schema, Rollback readiness)
 * 3. Deployment Execution
 * 4. Post-Deployment Verification (Hash verification, migration outcome, smoke tests)
 */

export type UpgradePhase =
  | 'BUILD'
  | 'REVIEW'
  | 'DEPLOYMENT'
  | 'POST_DEPLOYMENT_VERIFICATION';

export interface ChecklistItem {
  id: string;
  phase: UpgradePhase;
  title: string;
  description: string;
  commandOrReference?: string;
  requiredForSignoff: boolean;
}

export interface UpgradeVerificationState {
  wasmHash: string;
  network: 'testnet' | 'mainnet';
  deployedContractId: string;
  adminAddress: string;
  completedItemIds: string[];
}

/**
 * Authoritative checklist separated into the four operational phases.
 */
export const CONTRACT_UPGRADE_CHECKLIST: ChecklistItem[] = [
  // ─── 1. Build & Artifact Identity ──────────────────────────────────────────
  {
    id: 'build_deterministic_wasm',
    phase: 'BUILD',
    title: 'Deterministic Wasm Compilation',
    description: 'Compile contract targeting wasm32-unknown-unknown using locked toolchain dependencies.',
    commandOrReference: 'stellar contract build --manifest-path contracts/subscription/Cargo.toml',
    requiredForSignoff: true,
  },
  {
    id: 'build_optimize_wasm',
    phase: 'BUILD',
    title: 'Wasm Optimization',
    description: 'Optimize bytecode to minimize ledger storage fees and instruction meter consumption.',
    commandOrReference: 'stellar contract optimize --wasm target/wasm32-unknown-unknown/release/subscription.wasm',
    requiredForSignoff: true,
  },
  {
    id: 'build_compute_hash',
    phase: 'BUILD',
    title: 'Wasm Artifact Identity (SHA-256 Digest)',
    description: 'Compute cryptographic sha256 checksum of the release Wasm artifact.',
    commandOrReference: 'sha256sum target/wasm32-unknown-unknown/release/subscription.optimized.wasm',
    requiredForSignoff: true,
  },

  // ─── 2. Review ─────────────────────────────────────────────────────────────
  {
    id: 'review_storage_compatibility',
    phase: 'REVIEW',
    title: 'Storage Layout Compatibility',
    description: 'Verify existing SubscriptionData storage schema decodes correctly. New fields MUST be Option<T>.',
    commandOrReference: 'cargo test --manifest-path contracts/subscription/Cargo.toml --features upgrade-test -- upgrade',
    requiredForSignoff: true,
  },
  {
    id: 'review_authorization_guards',
    phase: 'REVIEW',
    title: 'Authorization Invariant Verification',
    description: 'Confirm that admin.require_auth() guards migrate() and admin-only entry points.',
    commandOrReference: 'contracts/subscription/src/lib.rs (migrate, set_max_amount, set_fee_config)',
    requiredForSignoff: true,
  },
  {
    id: 'review_event_schema_stability',
    phase: 'REVIEW',
    title: 'Event Schema Stability & Versioning',
    description: 'Ensure stable topic 0 discriminants and that off-chain indexers can decode contract_migrated.',
    commandOrReference: 'contracts/subscription/src/event_schema_tests.rs',
    requiredForSignoff: true,
  },
  {
    id: 'review_rollback_readiness',
    phase: 'REVIEW',
    title: 'Rollback Readiness & Contingency Plan',
    description: 'Document previous Wasm hash and emergency procedure if migration fails post-deployment.',
    commandOrReference: 'docs/operations.md (Rollback and Emergency Stop Runbook)',
    requiredForSignoff: true,
  },

  // ─── 3. Deployment ─────────────────────────────────────────────────────────
  {
    id: 'deploy_install_wasm',
    phase: 'DEPLOYMENT',
    title: 'Wasm Installation on Network',
    description: 'Install release Wasm bytecode to the target network and retrieve on-chain Wasm hash.',
    commandOrReference: 'stellar contract install --wasm target/wasm32-unknown-unknown/release/subscription.optimized.wasm --network <network> --source <admin>',
    requiredForSignoff: true,
  },
  {
    id: 'deploy_execute_migration',
    phase: 'DEPLOYMENT',
    title: 'Contract Migration Invocation',
    description: 'Invoke migrate(admin) with administrative multisig authorization.',
    commandOrReference: 'stellar contract invoke --id <contract_id> --network <network> --source <admin> -- migrate --admin <admin>',
    requiredForSignoff: true,
  },

  // ─── 4. Post-Deployment Verification ───────────────────────────────────────
  {
    id: 'verify_wasm_hash_match',
    phase: 'POST_DEPLOYMENT_VERIFICATION',
    title: 'Deployed Hash Verification',
    description: 'Verify the on-chain installed Wasm hash matches the pre-deployment reviewed SHA-256 digest.',
    commandOrReference: 'curl -s -X POST -H "Content-Type: application/json" -d \'{"jsonrpc":"2.0","id":1,"method":"getLedgerEntries"}\' <RPC_URL>',
    requiredForSignoff: true,
  },
  {
    id: 'verify_contract_migrated_event',
    phase: 'POST_DEPLOYMENT_VERIFICATION',
    title: 'Migration Event Emission Verification',
    description: 'Confirm contract_migrated event was emitted with CURRENT_SCHEMA_VERSION in recent ledger.',
    commandOrReference: 'stellar events --start-ledger <deploy_ledger> --network <network> --id <contract_id>',
    requiredForSignoff: true,
  },
  {
    id: 'verify_smoke_read',
    phase: 'POST_DEPLOYMENT_VERIFICATION',
    title: 'State Read Smoke Test',
    description: 'Confirm get_config() and get_subscription() return expected data without deserialization failure.',
    commandOrReference: 'stellar contract invoke --id <contract_id> --network <network> -- get_config',
    requiredForSignoff: true,
  },
];

/**
 * Validate SHA-256 hash format (64 hex characters).
 */
export function validateWasmHash(hash: string): {
  isValid: boolean;
  normalizedHash?: string;
  error?: string;
} {
  const trimmed = hash.trim().toLowerCase();
  if (!trimmed) {
    return { isValid: false, error: 'Wasm hash cannot be empty.' };
  }
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'Wasm hash must be exactly 64 hexadecimal characters (SHA-256).',
    };
  }
  return { isValid: true, normalizedHash: trimmed };
}

/**
 * Get items by phase.
 */
export function getChecklistByPhase(phase: UpgradePhase): ChecklistItem[] {
  return CONTRACT_UPGRADE_CHECKLIST.filter((item) => item.phase === phase);
}

/**
 * Validate that all required items for an upgrade release are signed off.
 */
export function validateUpgradeSignoff(completedItemIds: string[]): {
  isReadyForRelease: boolean;
  missingItems: ChecklistItem[];
} {
  const missing = CONTRACT_UPGRADE_CHECKLIST.filter(
    (item) => item.requiredForSignoff && !completedItemIds.includes(item.id),
  );

  return {
    isReadyForRelease: missing.length === 0,
    missingItems: missing,
  };
}

/**
 * Standard test commands linked to the release and upgrade process.
 */
export const UPGRADE_TEST_COMMANDS = {
  storageRegression: 'cargo test --manifest-path contracts/subscription/Cargo.toml --features upgrade-test -- upgrade',
  contractUnitTests: 'cargo test --manifest-path contracts/subscription/Cargo.toml',
  eventSchemaTests: 'cargo test --manifest-path contracts/subscription/Cargo.toml -- event_schema',
  backendParityTests: 'npm run test:backend -- tests/contractUpgradeChecklist.test.ts',
};
