/**
 * localWorkflowConfig.test.ts
 *
 * Automated verification of local testnet workflow environment templates,
 * runtime configurations, boundary conditions, and failure handling.
 *
 * Covers acceptance criteria for #1626:
 *  - Verifies commands and environment variable names match scripts and templates
 *  - Verifies clean-checkout default parameters (no personal state)
 *  - Validates boundary values for ports, URLs, contract IDs, and passphrases
 *  - Verifies reset behavior flag handling
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateConfig, ConfigValidationError } from '../src/lib/config';

describe('Local Testnet Workflow Configuration & Environment Parity', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const rootEnvExamplePath = path.join(rootDir, '.env.example');
  const backendEnvExamplePath = path.join(rootDir, 'backend/.env.example');
  const frontendEnvExamplePath = path.join(rootDir, 'frontend/.env.example');
  const dockerComposeDevPath = path.join(rootDir, 'docker-compose.dev.yml');

  it('verifies that .env.example contains expected local development defaults without personal state', () => {
    expect(fs.existsSync(rootEnvExamplePath)).toBe(true);
    const content = fs.readFileSync(rootEnvExamplePath, 'utf8');

    expect(content).toContain('POSTGRES_USER=sorobanpay');
    expect(content).toContain('POSTGRES_DB=sorobanpay');
    expect(content).toContain('RPC_URL=https://soroban-testnet.stellar.org');
    expect(content).toContain('NETWORK_PASSPHRASE=Test SDF Network ; September 2015');
    expect(content).toContain('PORT=4000');
    // Ensure no personal secrets or live contract addresses are hardcoded
    expect(content).toMatch(/CONTRACT_ID=\s*$/m);
  });

  it('verifies that backend/.env.example defines all required backend service variables', () => {
    expect(fs.existsSync(backendEnvExamplePath)).toBe(true);
    const content = fs.readFileSync(backendEnvExamplePath, 'utf8');

    expect(content).toContain('DATABASE_URL=');
    expect(content).toContain('RPC_URL="https://soroban-testnet.stellar.org"');
    expect(content).toContain('NETWORK_PASSPHRASE="Test SDF Network ; September 2015"');
    expect(content).toContain('CONTRACT_ID=');
    expect(content).toContain('PORT=3001');
    expect(content).toContain('REDIS_URL=');
  });

  it('verifies that frontend/.env.example defines testnet defaults and typed network configs', () => {
    expect(fs.existsSync(frontendEnvExamplePath)).toBe(true);
    const content = fs.readFileSync(frontendEnvExamplePath, 'utf8');

    expect(content).toContain('NEXT_PUBLIC_STELLAR_NETWORK=testnet');
    expect(content).toContain('NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org');
    expect(content).toContain('NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015');
    expect(content).toContain('NEXT_PUBLIC_CONTRACT_ID=');
  });

  it('verifies that docker-compose.dev.yml uses matching environment variable names and health checks', () => {
    expect(fs.existsSync(dockerComposeDevPath)).toBe(true);
    const content = fs.readFileSync(dockerComposeDevPath, 'utf8');

    expect(content).toContain('NEXT_PUBLIC_RPC_URL');
    expect(content).toContain('NEXT_PUBLIC_NETWORK_PASSPHRASE');
    expect(content).toContain('DATABASE_URL');
    expect(content).toContain('RPC_URL');
    expect(content).toContain('NETWORK_PASSPHRASE');
  });

  describe('Config validation and boundary cases', () => {
    const validTestnetConfig = {
      RPC_URL: 'https://soroban-testnet.stellar.org',
      CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      DATABASE_URL: 'postgresql://sorobanpay:devpassword@localhost:5432/sorobanpay',
      PORT: '3001',
      REDIS_URL: 'redis://localhost:6379',
    };

    it('successfully validates a complete testnet configuration', () => {
      const config = validateConfig(validTestnetConfig as NodeJS.ProcessEnv);
      expect(config.rpcUrl).toBe('https://soroban-testnet.stellar.org');
      expect(config.contractId).toBe('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC');
      expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
      expect(config.port).toBe(3001);
      expect(config.redisUrl).toBe('redis://localhost:6379');
    });

    it('rejects missing or malformed contract IDs', () => {
      // Missing
      expect(() =>
        validateConfig({ ...validTestnetConfig, CONTRACT_ID: '' } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);

      // Malformed prefix (G instead of C)
      expect(() =>
        validateConfig({
          ...validTestnetConfig,
          CONTRACT_ID: 'GDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);

      // Invalid length (55 chars instead of 56)
      expect(() =>
        validateConfig({
          ...validTestnetConfig,
          CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYS',
        } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);
    });

    it('rejects unsupported network passphrases', () => {
      expect(() =>
        validateConfig({
          ...validTestnetConfig,
          NETWORK_PASSPHRASE: 'Custom Local Testnet ; 2026',
        } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);
    });

    it('validates port number boundaries', () => {
      // Valid boundaries
      expect(
        validateConfig({ ...validTestnetConfig, PORT: '1' } as NodeJS.ProcessEnv).port,
      ).toBe(1);
      expect(
        validateConfig({ ...validTestnetConfig, PORT: '65535' } as NodeJS.ProcessEnv).port,
      ).toBe(65535);

      // Invalid boundaries: 0 or out of 16-bit range
      expect(() =>
        validateConfig({ ...validTestnetConfig, PORT: '0' } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);
      expect(() =>
        validateConfig({ ...validTestnetConfig, PORT: '65536' } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);
      expect(() =>
        validateConfig({ ...validTestnetConfig, PORT: 'not-a-port' } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);
    });

    it('accepts rediss:// secure redis URLs and validates malformed redis URLs', () => {
      const secureConfig = validateConfig({
        ...validTestnetConfig,
        REDIS_URL: 'rediss://user:token@redis.internal:6380',
      } as NodeJS.ProcessEnv);
      expect(secureConfig.redisUrl).toBe('rediss://user:token@redis.internal:6380');

      expect(() =>
        validateConfig({
          ...validTestnetConfig,
          REDIS_URL: 'http://localhost:6379',
        } as NodeJS.ProcessEnv),
      ).toThrow(ConfigValidationError);
    });
  });

  describe('Reset script argument handling', () => {
    it('seed-and-reset.sh script handles supported reset modes', () => {
      const scriptPath = path.join(rootDir, 'scripts/seed-and-reset.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
      const content = fs.readFileSync(scriptPath, 'utf8');

      expect(content).toContain('--reset-only');
      expect(content).toContain('--seed-only');
      expect(content).toContain('reset-local-db.ts');
      expect(content).toContain('seed-local-db.ts');
    });
  });
});
