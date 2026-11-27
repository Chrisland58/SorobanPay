/**
 * network_config.ts
 *
 * Single source of truth for all per-network constants in SorobanPay.
 *
 * ## Why this file exists
 *
 * Previously, `NETWORK_PASSPHRASE` and `RPC_URL` were scattered across
 * `runtime_config.ts`, `constants/network.ts`, `deploy/deploy.sh`, and
 * various component defaults — each with its own copy of the literal strings.
 * A typo in any one of them causes a silent network-mismatch failure.
 *
 * This module declares a single `NETWORK_CONFIGS` record keyed by
 * `StellarNetwork` (`"testnet" | "mainnet"`). Every other module that needs
 * network-specific values imports from here.
 *
 * ## Usage
 *
 * ```ts
 * import { getNetworkConfig, NETWORK_CONFIGS } from '@/lib/network_config';
 *
 * // Resolve from the current runtime environment:
 * const cfg = getNetworkConfig();
 * console.log(cfg.rpcUrl, cfg.networkPassphrase);
 *
 * // Or pick a specific network explicitly:
 * const testnet = NETWORK_CONFIGS.testnet;
 * const mainnet = NETWORK_CONFIGS.mainnet;
 * ```
 *
 * ## Adding a new network
 *
 * 1. Add the new name to the `StellarNetwork` union type.
 * 2. Add a matching entry to `NETWORK_CONFIGS` with all required fields.
 * 3. Update `deploy/deploy.sh` `case` block to match (the script comment
 *    references this file as the canonical source).
 */

// ── Network identifier ────────────────────────────────────────────────────────

/**
 * Supported Stellar network identifiers.
 *
 * - `"testnet"` — Stellar Testnet (SDF-hosted, free, resets periodically)
 * - `"mainnet"` — Stellar Mainnet (public production network)
 */
export type StellarNetwork = 'testnet' | 'mainnet';

// ── Per-network configuration shape ──────────────────────────────────────────

/**
 * All values that differ between Stellar networks.
 *
 * The interface is intentionally narrow: it only contains fields that
 * vary per network. Deployment-specific values (contract ID, identity)
 * live in `RuntimeConfig` in `runtime_config.ts`.
 */
export interface NetworkConfig {
  /**
   * Human-readable display name shown in the UI.
   * @example "Testnet", "Mainnet"
   */
  name: string;

  /**
   * Stellar network passphrase used to sign and verify transactions.
   *
   * This must exactly match the passphrase Freighter is configured with,
   * or every transaction will be rejected with a network-mismatch error.
   */
  networkPassphrase: string;

  /**
   * Default Soroban RPC endpoint for this network.
   *
   * Can be overridden at runtime via `NEXT_PUBLIC_RPC_URL` for custom
   * infrastructure (Validation Cloud, Blockdaemon, self-hosted nodes).
   */
  rpcUrl: string;

  /**
   * Stellar Horizon REST API endpoint for this network.
   * Used for account lookups and transaction history.
   */
  horizonUrl: string;

  /**
   * Base URL for the Stellar Expert block explorer.
   * Append `?network=<network>` for cross-links.
   * @example "https://stellar.expert/explorer/testnet"
   */
  explorerBaseUrl: string;

  /**
   * Whether this network is the production mainnet.
   * Use this flag to guard mainnet-only UI warnings.
   */
  isProduction: boolean;

  /**
   * Deployed Soroban contract address for this specific network.
   */
  contractId?: string;
}

// ── Contract Configuration Status ─────────────────────────────────────────────

export type ContractConfigStatus =
  | 'ready'
  | 'network-mismatch'
  | 'missing-config'
  | 'refreshing';

export interface ContractConfigState {
  status: ContractConfigStatus;
  contractId: string | null;
  network: StellarNetwork;
  error?: string;
}

// ── Canonical network definitions ─────────────────────────────────────────────

/**
 * The single authoritative map of network name → configuration.
 *
 * **Do not duplicate these string literals elsewhere.** Import from here.
 *
 * If you need to add a custom network (e.g. a local sandbox), extend
 * `StellarNetwork` and add a matching entry here.
 */
export const NETWORK_CONFIGS: Record<StellarNetwork, NetworkConfig> = {
  testnet: {
    name: 'Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
    isProduction: false,
  },
  mainnet: {
    name: 'Mainnet',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/xyciqR7GmMO0UHcbCwqCgjovqv9IFr-mf0xmHdGP9sI=',
    horizonUrl: 'https://horizon.stellar.org',
    explorerBaseUrl: 'https://stellar.expert/explorer/public',
    isProduction: true,
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve which `StellarNetwork` is active at runtime.
 *
 * Resolution order:
 * 1. `NEXT_PUBLIC_STELLAR_NETWORK` env var (`"testnet"` | `"mainnet"`)
 * 2. Passphrase match: if `NEXT_PUBLIC_NETWORK_PASSPHRASE` matches a known
 *    passphrase, that network is selected.
 * 3. Default: `"testnet"`.
 *
 * @throws {Error} if `NEXT_PUBLIC_STELLAR_NETWORK` is set to an unknown value.
 */
export function resolveActiveNetwork(): StellarNetwork {
  const explicit = process.env.NEXT_PUBLIC_STELLAR_NETWORK?.trim().toLowerCase();

  if (explicit) {
    if (explicit === 'testnet' || explicit === 'mainnet') {
      return explicit;
    }
    throw new Error(
      `[network_config] Unknown NEXT_PUBLIC_STELLAR_NETWORK value: "${explicit}". ` +
      `Allowed values: "testnet" | "mainnet".`,
    );
  }

  // Infer from passphrase if an explicit network key was not set.
  const passphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE?.trim();
  if (passphrase) {
    for (const [key, cfg] of Object.entries(NETWORK_CONFIGS) as [StellarNetwork, NetworkConfig][]) {
      if (cfg.networkPassphrase === passphrase) {
        return key;
      }
    }
  }

  // Safe default.
  return 'testnet';
}

/**
 * Return the `NetworkConfig` for the currently active network.
 *
 * Values from `NEXT_PUBLIC_RPC_URL` override `rpcUrl` so operators can
 * point the app at a custom RPC node without changing the config record.
 *
 * @example
 * ```ts
 * const { rpcUrl, networkPassphrase } = getNetworkConfig();
 * ```
 */
export function getNetworkConfig(): NetworkConfig {
  const network = resolveActiveNetwork();
  const base = NETWORK_CONFIGS[network];

  // Allow runtime override of the RPC URL (custom nodes, load balancers).
  const rpcUrlOverride = process.env.NEXT_PUBLIC_RPC_URL?.trim();

  return rpcUrlOverride
    ? { ...base, rpcUrl: rpcUrlOverride }
    : base;
}

/**
 * Type-guard: return `true` if `value` is a valid `StellarNetwork`.
 *
 * @example
 * ```ts
 * const raw = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
 * if (isStellarNetwork(raw)) {
 *   const cfg = NETWORK_CONFIGS[raw];
 * }
 * ```
 */
export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return value === 'testnet' || value === 'mainnet';
}

// ── Contract Network Synchronization & Invalidation ─────────────────────────

const contractCache = new Map<string, string>();
const networkListeners = new Set<(network: StellarNetwork) => void>();

/**
 * Register a listener for network changes.
 */
export function onNetworkChange(callback: (network: StellarNetwork) => void): () => void {
  networkListeners.add(callback);
  return () => {
    networkListeners.delete(callback);
  };
}

/**
 * Clear cached contract configurations and notify listeners that dependent data must be refreshed.
 */
export function invalidateContractCache(newNetwork?: StellarNetwork): void {
  contractCache.clear();
  if (newNetwork && isStellarNetwork(newNetwork)) {
    for (const listener of networkListeners) {
      try {
        listener(newNetwork);
      } catch (err) {
        console.error('[network_config] Error in network listener:', err);
      }
    }
  }
}

/**
 * Resolve contract address for a given network.
 * Priority:
 * 1. Network-specific env var (e.g. NEXT_PUBLIC_CONTRACT_ID_MAINNET / NEXT_PUBLIC_CONTRACT_ID_TESTNET)
 * 2. General NEXT_PUBLIC_CONTRACT_ID
 * 3. NETWORK_CONFIGS[network].contractId
 */
export function resolveContractIdForNetwork(network: StellarNetwork): string | null {
  const envSpecific =
    network === 'mainnet'
      ? process.env.NEXT_PUBLIC_CONTRACT_ID_MAINNET?.trim()
      : process.env.NEXT_PUBLIC_CONTRACT_ID_TESTNET?.trim();

  if (envSpecific) return envSpecific;

  const general = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
  if (general) return general;

  return NETWORK_CONFIGS[network].contractId ?? null;
}

/**
 * Retrieve the current contract configuration state for the given or active network.
 */
export function getContractConfig(activeWalletNetwork?: StellarNetwork | null): ContractConfigState {
  const currentNetwork = resolveActiveNetwork();

  // If wallet reported a network and it does not match app network
  if (activeWalletNetwork && activeWalletNetwork !== currentNetwork) {
    return {
      status: 'network-mismatch',
      contractId: null,
      network: currentNetwork,
      error: `Wallet is on ${activeWalletNetwork} while app requires ${currentNetwork}.`,
    };
  }

  const contractId = resolveContractIdForNetwork(currentNetwork);
  if (!contractId) {
    return {
      status: 'missing-config',
      contractId: null,
      network: currentNetwork,
      error: `Contract configuration missing for ${currentNetwork}.`,
    };
  }

  return {
    status: 'ready',
    contractId,
    network: currentNetwork,
  };
}

/**
 * Guard write operations: asserts that the contract ID is configured and matches the target network.
 * Throws a descriptive error if the configuration is invalid or mismatched.
 */
export function assertContractConfigForNetwork(
  targetNetwork: StellarNetwork,
  contractId: string | null | undefined,
): void {
  const activeNetwork = resolveActiveNetwork();
  if (targetNetwork !== activeNetwork) {
    throw new Error(
      `Cannot execute write action: Contract network mismatch. Active network is ${activeNetwork}, but transaction targeted ${targetNetwork}.`,
    );
  }
  if (!contractId || !contractId.trim()) {
    throw new Error(
      `Cannot execute write action: No contract ID configured for ${targetNetwork}.`,
    );
  }
}
