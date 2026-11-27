#!/usr/bin/env ts-node
/**
 * Preflight deployment configuration validator.
 *
 * Validates network, contract, database, and public frontend environment
 * variables using the shared application startup validation rules in
 * backend/src/lib/config.ts without printing any variable values.
 */
import {
  ConfigValidationError,
  validateDeploymentConfig,
} from '../backend/src/lib/config';

const VALIDATED_VARIABLES = [
  'RPC_URL',
  'CONTRACT_ID',
  'NETWORK_PASSPHRASE',
  'DATABASE_URL',
  'REDIS_URL (optional)',
  'PORT (optional)',
  'NEXT_PUBLIC_CONTRACT_ID',
  'NEXT_PUBLIC_RPC_URL',
  'NEXT_PUBLIC_NETWORK_PASSPHRASE',
];

function main(): void {
  try {
    validateDeploymentConfig(process.env);
    console.log(
      `Preflight configuration check passed (${VALIDATED_VARIABLES.join(', ')}).`,
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('Preflight configuration check failed:');
      for (const message of err.errors) {
        console.error(`  - ${message}`);
      }
      process.exit(1);
    }
    console.error('Preflight configuration check failed with an unexpected error.');
    process.exit(1);
  }
}

main();
