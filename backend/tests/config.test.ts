import {
  validateConfig,
  validateDeploymentConfig,
  ConfigValidationError,
} from '../src/lib/config';

const VALID_ENV = {
  RPC_URL: 'https://soroban-testnet.stellar.org',
  CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/sorobanpay',
  PORT: '3001',
} as NodeJS.ProcessEnv;

describe('validateConfig', () => {
  it('returns a typed config for a valid environment', () => {
    const config = validateConfig(VALID_ENV);
    expect(config.rpcUrl).toBe(VALID_ENV.RPC_URL);
    expect(config.contractId).toBe(VALID_ENV.CONTRACT_ID);
    expect(config.networkPassphrase).toBe(VALID_ENV.NETWORK_PASSPHRASE);
    expect(config.port).toBe(3001);
  });

  it('accepts mainnet passphrase', () => {
    const env = {
      ...VALID_ENV,
      NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
    };
    expect(() => validateConfig(env)).not.toThrow();
  });

  it('defaults PORT to 3001 when absent', () => {
    const { PORT: _, ...env } = VALID_ENV;
    expect(validateConfig(env as NodeJS.ProcessEnv).port).toBe(3001);
  });

  it('throws ConfigValidationError when RPC_URL is missing', () => {
    const { RPC_URL: _, ...env } = VALID_ENV;
    expect(() => validateConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('throws when RPC_URL is not a valid URL', () => {
    try {
      validateConfig({ ...VALID_ENV, RPC_URL: 'not-a-url' });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/RPC_URL must be/),
      );
    }
  });

  it('throws when CONTRACT_ID is missing', () => {
    const { CONTRACT_ID: _, ...env } = VALID_ENV;
    expect(() => validateConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('throws when CONTRACT_ID has wrong format', () => {
    try {
      validateConfig({ ...VALID_ENV, CONTRACT_ID: 'GNOTACONTRACTID' });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/CONTRACT_ID must be/),
      );
    }
  });

  it('throws when NETWORK_PASSPHRASE is unknown', () => {
    try {
      validateConfig({ ...VALID_ENV, NETWORK_PASSPHRASE: 'wrong passphrase' });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/NETWORK_PASSPHRASE is not a recognised/),
      );
    }
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...env } = VALID_ENV;
    expect(() => validateConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('accumulates multiple errors in a single throw', () => {
    try {
      validateConfig({} as NodeJS.ProcessEnv);
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors.length).toBeGreaterThan(1);
    }
  });

  it('rejects DATABASE_URL with invalid scheme without echoing its value', () => {
    const secretDbUrl = 'mysql://admin:supersecret@db.internal:3306/sorobanpay';
    try {
      validateConfig({ ...VALID_ENV, DATABASE_URL: secretDbUrl });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringMatching(/DATABASE_URL/));
      expect(err.message).not.toContain(secretDbUrl);
      expect(err.message).not.toContain('supersecret');
    }
  });

  it('does not echo invalid values for RPC_URL, CONTRACT_ID, REDIS_URL, or PORT', () => {
    const secretRedis = 'http://:redis-secret@cache.internal:6379';
    try {
      validateConfig({
        ...VALID_ENV,
        RPC_URL: 'ftp://bad-rpc-secret',
        CONTRACT_ID: 'GBADSECRETCONTRACT',
        REDIS_URL: secretRedis,
        PORT: '99999',
      });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const msg = (e as ConfigValidationError).message;
      expect(msg).not.toContain('bad-rpc-secret');
      expect(msg).not.toContain('GBADSECRETCONTRACT');
      expect(msg).not.toContain('redis-secret');
      expect(msg).not.toContain('99999');
    }
  });

  it('accepts boundary PORT values 1 and 65535 and rejects 0 and 65536', () => {
    expect(validateConfig({ ...VALID_ENV, PORT: '1' }).port).toBe(1);
    expect(validateConfig({ ...VALID_ENV, PORT: '65535' }).port).toBe(65535);
    expect(() => validateConfig({ ...VALID_ENV, PORT: '0' })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ ...VALID_ENV, PORT: '65536' })).toThrow(ConfigValidationError);
  });
});

const VALID_DEPLOYMENT_ENV = {
  ...VALID_ENV,
  NEXT_PUBLIC_CONTRACT_ID: VALID_ENV.CONTRACT_ID,
  NEXT_PUBLIC_RPC_URL: VALID_ENV.RPC_URL,
  NEXT_PUBLIC_NETWORK_PASSPHRASE: VALID_ENV.NETWORK_PASSPHRASE,
} as NodeJS.ProcessEnv;

describe('validateDeploymentConfig', () => {
  it('passes for a complete and consistent deployment environment', () => {
    const config = validateDeploymentConfig(VALID_DEPLOYMENT_ENV);
    expect(config.nextPublicContractId).toBe(VALID_ENV.CONTRACT_ID);
    expect(config.nextPublicRpcUrl).toBe(VALID_ENV.RPC_URL);
    expect(config.nextPublicNetworkPassphrase).toBe(VALID_ENV.NETWORK_PASSPHRASE);
  });

  it('fails when NEXT_PUBLIC_CONTRACT_ID is missing or malformed', () => {
    expect(() =>
      validateDeploymentConfig({
        ...VALID_DEPLOYMENT_ENV,
        NEXT_PUBLIC_CONTRACT_ID: '',
      }),
    ).toThrow(ConfigValidationError);

    expect(() =>
      validateDeploymentConfig({
        ...VALID_DEPLOYMENT_ENV,
        NEXT_PUBLIC_CONTRACT_ID: 'INVALID_CONTRACT',
      }),
    ).toThrow(ConfigValidationError);
  });

  it('fails when NEXT_PUBLIC_CONTRACT_ID does not match CONTRACT_ID', () => {
    const otherContract = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB5H6Q';
    try {
      validateDeploymentConfig({
        ...VALID_DEPLOYMENT_ENV,
        NEXT_PUBLIC_CONTRACT_ID: otherContract,
      });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/NEXT_PUBLIC_CONTRACT_ID must match CONTRACT_ID/),
      );
    }
  });

  it('fails when NEXT_PUBLIC_NETWORK_PASSPHRASE does not match NETWORK_PASSPHRASE', () => {
    try {
      validateDeploymentConfig({
        ...VALID_DEPLOYMENT_ENV,
        NEXT_PUBLIC_NETWORK_PASSPHRASE:
          'Public Global Stellar Network ; September 2015',
      });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(
          /NEXT_PUBLIC_NETWORK_PASSPHRASE must match NETWORK_PASSPHRASE/,
        ),
      );
    }
  });
});
