/**
 * #137 — Runtime config validation.
 * Call validateConfig() before starting the server; it throws on any bad value.
 */

export interface AppConfig {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
  port: number;
  databaseUrl: string;
  /** Redis URL for BullMQ payment retry queue. undefined = retry queue disabled. */
  redisUrl: string | undefined;
}

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const URL_RE = /^https?:\/\/.+/;
const DATABASE_URL_RE = /^postgres(ql)?:\/\/.+/;
const REDIS_URL_RE = /^rediss?:\/\/.+/;
const KNOWN_PASSPHRASES = new Set([
  'Test SDF Network ; September 2015',
  'Public Global Stellar Network ; September 2015',
]);

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  const rpcUrl = env.RPC_URL ?? '';
  if (!rpcUrl) {
    errors.push('RPC_URL is required');
  } else if (!URL_RE.test(rpcUrl)) {
    errors.push('RPC_URL must be a valid http/https URL');
  }

  const contractId = env.CONTRACT_ID ?? '';
  if (!contractId) {
    errors.push('CONTRACT_ID is required');
  } else if (!CONTRACT_ID_RE.test(contractId)) {
    errors.push(
      'CONTRACT_ID must be a 56-character Stellar contract address starting with "C"',
    );
  }

  const networkPassphrase = env.NETWORK_PASSPHRASE ?? '';
  if (!networkPassphrase) {
    errors.push('NETWORK_PASSPHRASE is required');
  } else if (!KNOWN_PASSPHRASES.has(networkPassphrase)) {
    errors.push('NETWORK_PASSPHRASE is not a recognised Stellar network passphrase');
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required');
  } else if (!DATABASE_URL_RE.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a valid postgresql:// or postgres:// URL');
  }

  // REDIS_URL is optional. When provided it must be a valid redis:// or rediss:// URL.
  const rawRedisUrl = env.REDIS_URL;
  let redisUrl: string | undefined;
  if (rawRedisUrl) {
    if (!REDIS_URL_RE.test(rawRedisUrl)) {
      errors.push('REDIS_URL must be a valid redis:// or rediss:// URL');
    } else {
      redisUrl = rawRedisUrl;
    }
  }

  const rawPort = env.PORT;
  const port = rawPort ? parseInt(rawPort, 10) : 3001;
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid port number between 1 and 65535');
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return { rpcUrl, contractId, networkPassphrase, databaseUrl, port, redisUrl };
}

export interface DeploymentConfig extends AppConfig {
  nextPublicContractId: string;
  nextPublicRpcUrl: string;
  nextPublicNetworkPassphrase: string;
}

/**
 * Preflight deployment configuration validation.
 * Shares startup validation rules via validateConfig() and additionally checks
 * public frontend settings and backend/frontend consistency without echoing values.
 */
export function validateDeploymentConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentConfig {
  const errors: string[] = [];
  let appConfig: AppConfig | undefined;

  try {
    appConfig = validateConfig(env);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      errors.push(...err.errors);
    } else {
      throw err;
    }
  }

  const nextPublicContractId = env.NEXT_PUBLIC_CONTRACT_ID ?? '';
  if (!nextPublicContractId) {
    errors.push('NEXT_PUBLIC_CONTRACT_ID is required');
  } else if (!CONTRACT_ID_RE.test(nextPublicContractId)) {
    errors.push(
      'NEXT_PUBLIC_CONTRACT_ID must be a 56-character Stellar contract address starting with "C"',
    );
  } else if (appConfig && nextPublicContractId !== appConfig.contractId) {
    errors.push('NEXT_PUBLIC_CONTRACT_ID must match CONTRACT_ID');
  }

  const nextPublicRpcUrl = env.NEXT_PUBLIC_RPC_URL ?? '';
  if (!nextPublicRpcUrl) {
    errors.push('NEXT_PUBLIC_RPC_URL is required');
  } else if (!URL_RE.test(nextPublicRpcUrl)) {
    errors.push('NEXT_PUBLIC_RPC_URL must be a valid http/https URL');
  }

  const nextPublicNetworkPassphrase = env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? '';
  if (!nextPublicNetworkPassphrase) {
    errors.push('NEXT_PUBLIC_NETWORK_PASSPHRASE is required');
  } else if (!KNOWN_PASSPHRASES.has(nextPublicNetworkPassphrase)) {
    errors.push(
      'NEXT_PUBLIC_NETWORK_PASSPHRASE is not a recognised Stellar network passphrase',
    );
  } else if (
    appConfig &&
    nextPublicNetworkPassphrase !== appConfig.networkPassphrase
  ) {
    errors.push('NEXT_PUBLIC_NETWORK_PASSPHRASE must match NETWORK_PASSPHRASE');
  }

  if (errors.length > 0 || !appConfig) {
    throw new ConfigValidationError(errors);
  }

  return {
    ...appConfig,
    nextPublicContractId,
    nextPublicRpcUrl,
    nextPublicNetworkPassphrase,
  };
}
