import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = { ...process.env };
  const tempDirs: string[] = [];
  const keyA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const keyB = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const keyC = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';
  const keyD = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=';
  const keyE = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=';
  const keyF = 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU=';
  const requiredSecrets = {
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars!!',
    TOTP_ENCRYPTION_ACTIVE_KEY_ID: 'enc-v1',
    TOTP_ENCRYPTION_KEYS: { 'enc-v1': keyA },
    RECOVERY_HMAC_ACTIVE_KEY_ID: 'recovery-v1',
    RECOVERY_HMAC_KEYS: { 'recovery-v1': keyB },
    AUTH_THROTTLE_HMAC_KEY: keyC,
  };

  afterEach(() => {
    process.env = { ...originalEnv };
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds mongo uri from environment topology and secret credentials', () => {
    const tempDir = createTempDir();
    const secretsPath = join(tempDir, 'secrets.json');

    writeFileSync(
      secretsPath,
      JSON.stringify({
        ...requiredSecrets,
        MONGO_USER: 'finance-user',
        MONGO_PASSWORD: 'strong-pass',
      }),
    );

    process.env.PORT = '3010';
    process.env.API_PREFIX = 'api/v1';
    process.env.MONGO_DB_NAME = 'finance-db';
    process.env.MONGO_HOST = '127.0.0.1';
    process.env.MONGO_PORT = '27018';
    process.env.MONGO_AUTH_SOURCE = 'admin';
    process.env.SECRETS_FILE_PATH = relative(process.cwd(), secretsPath);

    const result = configuration();

    expect(result.app.port).toBe(3010);
    expect(result.mongo.uri).toBe(
      'mongodb://finance-user:strong-pass@127.0.0.1:27018/finance-db?authSource=admin',
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers a full mongo uri when provided in secrets', () => {
    const tempDir = createTempDir();
    const secretsPath = join(tempDir, 'secrets.json');

    writeFileSync(
      secretsPath,
      JSON.stringify({
        ...requiredSecrets,
        MONGO_URI: 'mongodb://localhost:27017/custom-db',
      }),
    );

    process.env.MONGO_DB_NAME = 'ignored-db-name';
    process.env.SECRETS_FILE_PATH = relative(process.cwd(), secretsPath);

    const result = configuration();

    expect(result.mongo.uri).toBe('mongodb://localhost:27017/custom-db');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends replicaSet params with ? separator when no auth query string exists', () => {
    const tempDir = createTempDir();
    const secretsPath = join(tempDir, 'secrets.json');

    writeFileSync(
      secretsPath,
      JSON.stringify({
        ...requiredSecrets,
      }),
    );

    process.env.MONGO_DB_NAME = 'finance-db';
    process.env.MONGO_AUTH_ENABLED = 'false';
    process.env.MONGO_HOST = '127.0.0.1';
    process.env.MONGO_PORT = '27017';
    process.env.MONGO_REPLICA_SET = 'rs0';
    process.env.SECRETS_FILE_PATH = relative(process.cwd(), secretsPath);

    const result = configuration();

    expect(result.mongo.uri).toBe(
      'mongodb://127.0.0.1:27017/finance-db?replicaSet=rs0&directConnection=true',
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends replicaSet params with & separator when auth query string already exists', () => {
    const tempDir = createTempDir();
    const secretsPath = join(tempDir, 'secrets.json');

    writeFileSync(
      secretsPath,
      JSON.stringify({
        ...requiredSecrets,
        MONGO_USER: 'finance-user',
        MONGO_PASSWORD: 'strong-pass',
      }),
    );

    process.env.MONGO_DB_NAME = 'finance-db';
    process.env.MONGO_HOST = '127.0.0.1';
    process.env.MONGO_PORT = '27018';
    process.env.MONGO_AUTH_SOURCE = 'admin';
    process.env.MONGO_REPLICA_SET = 'rs0';
    process.env.SECRETS_FILE_PATH = relative(process.cwd(), secretsPath);

    const result = configuration();

    expect(result.mongo.uri).toBe(
      'mongodb://finance-user:strong-pass@127.0.0.1:27018/finance-db?authSource=admin&replicaSet=rs0&directConnection=true',
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when a required authentication key is missing', () => {
    const { AUTH_THROTTLE_HMAC_KEY: _missing, ...secrets } = requiredSecrets;
    setSecrets(secrets);

    expect(() => configuration()).toThrow(
      'AUTH_THROTTLE_HMAC_KEY must be defined',
    );
  });

  it.each([
    ['TOTP encryption', { TOTP_ENCRYPTION_KEYS: { 'enc-v1': 'not-base64' } }],
    ['recovery HMAC', { RECOVERY_HMAC_KEYS: { 'recovery-v1': keyA.slice(4) } }],
    ['throttle HMAC', { AUTH_THROTTLE_HMAC_KEY: keyA.slice(4) }],
  ])('rejects malformed or short %s keys', (_label, override) => {
    setSecrets({ ...requiredSecrets, ...override });

    expect(() => configuration()).toThrow(/valid Base64-encoded 32-byte key/);
  });

  it('rejects an encryption active key id absent from its keyring', () => {
    setSecrets({
      ...requiredSecrets,
      TOTP_ENCRYPTION_ACTIVE_KEY_ID: 'enc-v2',
    });

    expect(() => configuration()).toThrow(
      'TOTP_ENCRYPTION_ACTIVE_KEY_ID must reference a configured key',
    );
  });

  it.each([
    [
      'encryption and recovery keyrings',
      { RECOVERY_HMAC_KEYS: { 'recovery-v1': keyA } },
    ],
    ['encryption and throttle', { AUTH_THROTTLE_HMAC_KEY: keyA }],
    ['recovery and throttle', { AUTH_THROTTLE_HMAC_KEY: keyB }],
    [
      'inactive encryption and recovery keys',
      {
        TOTP_ENCRYPTION_KEYS: { 'enc-v1': keyA, 'enc-old': keyB },
      },
    ],
    ['JWT signing and encryption', { JWT_SECRET: keyA }],
  ])('rejects reused material across %s', (_label, override) => {
    setSecrets({ ...requiredSecrets, ...override });

    expect(() => configuration()).toThrow(/independent key material/);
  });

  it('returns safe authentication defaults and explicit rollout settings', () => {
    setSecrets(requiredSecrets);
    process.env.TOTP_ENROLLMENT_ENABLED = 'true';
    process.env.TRUST_PROXY = 'loopback';

    const result = configuration();

    expect(result.app.trustProxy).toBe('loopback');
    expect(result.twoFactor).toMatchObject({
      enrollmentEnabled: true,
      issuer: 'Babki',
      setupTtlSeconds: 600,
      challengeTtlSeconds: 300,
    });
    expect(result.authLimits).toEqual({
      windowSeconds: 900,
      blockSeconds: 900,
      passwordEmailFailures: 5,
      passwordIpFailures: 50,
      challengeFailures: 5,
      secondFactorFailures: 10,
    });
    expect(result.security.totpEncryption.activeKeyId).toBe('enc-v1');
    expect(result.security.totpEncryption.keys['enc-v1']).toHaveLength(32);
    expect(result.security.recoveryHmac.keys['recovery-v1']).toHaveLength(32);
    expect(result.security.throttleHmacKey).toHaveLength(32);
    expect(result.userDeletion).toEqual({
      enabled: false,
      leaseSeconds: 300,
    });
  });

  it('reads Mongo topology and runtime policies from the environment', () => {
    setSecrets({
      ...requiredSecrets,
      MONGO_USER: 'finance-user',
      MONGO_PASSWORD: 'strong-pass',
    });
    process.env.MONGO_AUTH_ENABLED = 'true';
    process.env.MONGO_HOST = '127.0.0.1';
    process.env.MONGO_PORT = '27018';
    process.env.MONGO_AUTH_SOURCE = 'admin';
    process.env.MONGO_REPLICA_SET = 'rs-test';
    process.env.JWT_EXPIRES_IN = '45m';
    process.env.TOTP_ENROLLMENT_ENABLED = 'true';
    process.env.TOTP_ISSUER = 'Babki Test';
    process.env.TRUST_PROXY = 'loopback';

    const result = configuration();

    expect(result.mongo.uri).toBe(
      'mongodb://finance-user:strong-pass@127.0.0.1:27018/finance-db?authSource=admin&replicaSet=rs-test&directConnection=true',
    );
    expect(result.jwt.expiresIn).toBe('45m');
    expect(result.twoFactor).toMatchObject({
      enrollmentEnabled: true,
      issuer: 'Babki Test',
    });
    expect(result.app.trustProxy).toBe('loopback');
  });

  it('ignores legacy general settings from the secrets file', () => {
    setSecrets({
      ...requiredSecrets,
      JWT_EXPIRES_IN: '99d',
      MONGO_AUTH_ENABLED: false,
      MONGO_HOST: 'legacy-mongo',
      MONGO_PORT: 27099,
      MONGO_REPLICA_SET: 'legacy-rs',
      TOTP_ENROLLMENT_ENABLED: true,
      TOTP_ISSUER: 'Legacy issuer',
      TRUST_PROXY: 'loopback',
    });

    const result = configuration();

    expect(result.mongo.uri).toBe('mongodb://localhost:27017/finance-db');
    expect(result.jwt.expiresIn).toBe('60m');
    expect(result.twoFactor).toMatchObject({
      enrollmentEnabled: false,
      issuer: 'Babki',
    });
    expect(result.app.trustProxy).toBe(false);
  });

  it('reads authentication secrets only from the secrets file', () => {
    setSecrets(requiredSecrets);
    process.env.JWT_SECRET = 'environment-jwt-secret-at-least-32-chars';
    process.env.TOTP_ENCRYPTION_ACTIVE_KEY_ID = 'env-enc';
    process.env.TOTP_ENCRYPTION_KEYS = JSON.stringify({ 'env-enc': keyD });
    process.env.RECOVERY_HMAC_ACTIVE_KEY_ID = 'env-recovery';
    process.env.RECOVERY_HMAC_KEYS = JSON.stringify({
      'env-recovery': keyE,
    });
    process.env.AUTH_THROTTLE_HMAC_KEY = keyF;

    const result = configuration();

    expect(result.jwt.secret).toBe(requiredSecrets.JWT_SECRET);
    expect(result.security.totpEncryption).toMatchObject({
      activeKeyId: 'enc-v1',
    });
    expect(result.security.totpEncryption.keys['enc-v1']).toEqual(
      Buffer.from(keyA, 'base64'),
    );
    expect(result.security.recoveryHmac).toMatchObject({
      activeKeyId: 'recovery-v1',
    });
    expect(result.security.recoveryHmac.keys['recovery-v1']).toEqual(
      Buffer.from(keyB, 'base64'),
    );
    expect(result.security.throttleHmacKey).toEqual(
      Buffer.from(keyC, 'base64'),
    );
  });

  it.each([
    ['', 'project-relative path'],
    ['/absolute/secrets.json', 'project-relative path'],
    ['../outside.json', 'project-relative path'],
    ['config/secrets/missing.json', 'Secrets file does not exist'],
  ])('rejects an invalid secrets path %s', (secretsPath, message) => {
    process.env.MONGO_DB_NAME = 'finance-db';
    process.env.SECRETS_FILE_PATH = secretsPath;

    expect(() => configuration()).toThrow(message);
  });

  function setSecrets(secrets: Record<string, unknown>) {
    const tempDir = createTempDir();
    const secretsPath = join(tempDir, 'secrets.json');
    writeFileSync(secretsPath, JSON.stringify(secrets));
    process.env.MONGO_DB_NAME = 'finance-db';
    process.env.SECRETS_FILE_PATH = relative(process.cwd(), secretsPath);
  }

  function createTempDir() {
    const tempRoot = join(process.cwd(), '.temp');
    mkdirSync(tempRoot, { recursive: true });
    const tempDir = mkdtempSync(join(tempRoot, 'babki-config-'));
    tempDirs.push(tempDir);
    return tempDir;
  }
});
