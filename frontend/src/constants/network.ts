/**
 * network.ts
 *
 * Network configuration constants derived from runtime config.
 * These values are loaded at runtime from environment variables
 * or a configuration endpoint, allowing changes without rebuilding.
 *
 * @deprecated Use getRuntimeConfig() from @/lib/runtime_config instead
 * to access the latest configuration values. These exports are maintained
 * for backward compatibility but will be removed in a future version.
 */

import { getRuntimeConfig } from '@/lib/runtime_config';

// Get initial config at module load time
const _initialConfig = getRuntimeConfig();

/**
 * @deprecated Use getRuntimeConfig().rpcUrl instead
 */
export const RPC_URL = _initialConfig.rpcUrl;

/**
 * @deprecated Use getRuntimeConfig().networkPassphrase instead
 */
export const NETWORK_PASSPHRASE = _initialConfig.networkPassphrase;

/**
 * @deprecated Use getRuntimeConfig().contractId instead
 */
export const CONTRACT_ID = _initialConfig.contractId;

/**
 * @deprecated Use getRuntimeConfig().networkName instead
 */
export const NETWORK_NAME = _initialConfig.networkName;
