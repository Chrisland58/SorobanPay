/**
 * network.ts
 *
 * Single source of truth for Stellar network configuration.
 *
 * Usage:
 *   import { getNetworkConfig } from '@/constants/network';
 *   const { rpcUrl, networkPassphrase, contractId } = getNetworkConfig();
 *
 * Runtime network selection is driven by the NEXT_PUBLIC_STELLAR_NETWORK env
 * variable ('testnet' | 'mainnet'). Defaults to 'testnet' when the variable
 * is absent or empty.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/** All valid network identifiers. */
export type NetworkName = 'testnet' | 'mainnet';

/** Immutable configuration object for a single Stellar network. */
export interface NetworkConfig {
  /** Human-readable identifier, e.g. "testnet" */
  readonly name: NetworkName;
  /** Soroban RPC endpoint URL for this network */
  readonly rpcUrl: string;
  /** Stellar network passphrase used to sign & verify transactions */
  readonly networkPassphrase: string;
  /**
   * Deployed SorobanPay contract address on this network.
   * Sourced from NEXT_PUBLIC_CONTRACT_ID at build time; empty string if unset.
   */
  readonly contractId: string;
}

// ─── Preset values ─────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';

/**
 * Hard-coded network presets. RPC URL and passphrase are authoritative values
 * that must never be overridden by stale environment variables — only the
 * contract address and network selection come from env.
 */
export const NETWORKS: Readonly<Record<NetworkName, NetworkConfig>> = {
  testnet: {
    name: 'testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: CONTRACT_ID,
  },
  mainnet: {
    name: 'mainnet',
    rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/xyciqR7GmMO0UHcbCwqCgjovqv9IFr-mf0xmHdGP9sI=',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    contractId: CONTRACT_ID,
  },
} as const;

// ─── Runtime selection ─────────────────────────────────────────────────────────

/**
 * Return the NetworkConfig for the currently-configured network.
 *
 * Network is selected by the NEXT_PUBLIC_STELLAR_NETWORK environment variable:
 *   - "testnet"  → testnet preset (default when variable is absent or empty)
 *   - "mainnet"  → mainnet preset
 *   - any other value → warns in development and falls back to testnet
 *
 * @example
 *   const { rpcUrl, networkPassphrase, contractId } = getNetworkConfig();
 */
export function getNetworkConfig(): NetworkConfig {
  const raw = process.env.NEXT_PUBLIC_STELLAR_NETWORK?.trim().toLowerCase();

  if (!raw || raw === 'testnet') {
    return NETWORKS.testnet;
  }

  if (raw === 'mainnet') {
    return NETWORKS.mainnet;
  }

  // Unknown value — warn in non-production environments and fall back safely.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[SorobanPay] Unknown NEXT_PUBLIC_STELLAR_NETWORK value: "${raw}". ` +
        'Expected "testnet" or "mainnet". Falling back to "testnet".',
    );
  }

  return NETWORKS.testnet;
}

// ─── Legacy named exports (kept for backward-compat during migration) ──────────
// These derive their values from the typed presets so they always stay in sync.

/** @deprecated Use getNetworkConfig().rpcUrl instead */
export const RPC_URL = getNetworkConfig().rpcUrl;

/** @deprecated Use getNetworkConfig().networkPassphrase instead */
export const NETWORK_PASSPHRASE = getNetworkConfig().networkPassphrase;

/** @deprecated Use getNetworkConfig().contractId instead */
export const CONTRACT_ID_EXPORT = CONTRACT_ID;

// Re-export CONTRACT_ID under its original name so existing imports compile.
export { CONTRACT_ID };
