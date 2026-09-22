import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

type SecretsFile = {
  AUTH_THROTTLE_HMAC_KEY?: string;
  JWT_SECRET?: string;
  MONGO_URI?: string;
  MONGO_USER?: string;
  MONGO_PASSWORD?: string;
  RECOVERY_HMAC_ACTIVE_KEY_ID?: string;
  RECOVERY_HMAC_KEYS?: Record<string, string>;
  TOTP_ENCRYPTION_ACTIVE_KEY_ID?: string;
  TOTP_ENCRYPTION_KEYS?: Record<string, string>;
};

type Keyring = {
  activeKeyId: string;
  keys: Record<string, Buffer>;
};

function readSecretsFile(filePath: string): SecretsFile {
  if (
    !filePath.trim() ||
    isAbsolute(filePath) ||
    filePath.split(/[\\/]+/).some((segment) => segment === '..')
  ) {
    throw new Error(
      'SECRETS_FILE_PATH must be a project-relative path without parent-directory traversal.',
    );
  }

  const absolutePath = resolve(process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Secrets file does not exist: ${filePath}.`);
  }

  return JSON.parse(readFileSync(absolutePath, 'utf8')) as SecretsFile;
}

function buildMongoUri(secrets: SecretsFile, databaseName: string): string {
  if (secrets.MONGO_URI) {
    // When MONGO_URI is provided directly, MONGO_REPLICA_SET is not applied.
    // Include replica set params in MONGO_URI itself if needed.
    return secrets.MONGO_URI;
  }

  const host = process.env.MONGO_HOST ?? 'localhost';
  const port = process.env.MONGO_PORT ?? '27017';
  const authSource = process.env.MONGO_AUTH_SOURCE ?? 'admin';
  const encodedUser = encodeURIComponent(secrets.MONGO_USER ?? '');
  const encodedPassword = encodeURIComponent(secrets.MONGO_PASSWORD ?? '');

  const mongoAuthEnabled = parseBoolean(
    process.env.MONGO_AUTH_ENABLED,
    Boolean(secrets.MONGO_USER || secrets.MONGO_PASSWORD),
  );

  let uri: string;

  if (!mongoAuthEnabled) {
    uri = `mongodb://${host}:${port}/${databaseName}`;
  } else {
    if (!encodedUser || !encodedPassword) {
      throw new Error(
        'MongoDB configuration is invalid. Provide MONGO_URI or MONGO_USER/MONGO_PASSWORD in the secrets file.',
      );
    }
    uri = `mongodb://${encodedUser}:${encodedPassword}@${host}:${port}/${databaseName}?authSource=${authSource}`;
  }

  const replicaSet = process.env.MONGO_REPLICA_SET;
  if (replicaSet) {
    const separator = uri.includes('?') ? '&' : '?';
    // directConnection=true routes to the single host and skips member discovery.
    // This is correct for single-node replica sets (dev/Docker) but must not be
    // used against multi-node production clusters, as it disables automatic failover.
    uri += `${separator}replicaSet=${replicaSet}&directConnection=true`;
  }

  return uri;
}

function parseBoolean(value: boolean | string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Expected a boolean value, received ${value}.`);
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }

  return parsed;
}

function parseTrustProxy(value: boolean | number | string | undefined) {
  if (value === undefined || value === false || value === 'false') {
    return false;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

function parseJsonKeyring(
  envName: string,
  value: string | Record<string, string> | undefined,
) {
  if (value === undefined) {
    throw new Error(`${envName} must be defined.`);
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }

    return parsed as Record<string, string>;
  } catch {
    throw new Error(`${envName} must be a JSON object of Base64 keys.`);
  }
}

function parseBase64Key(name: string, value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error(`${name} must be a valid Base64-encoded 32-byte key.`);
  }

  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error(`${name} must be a valid Base64-encoded 32-byte key.`);
  }

  return key;
}

function buildKeyring(
  prefix: 'TOTP_ENCRYPTION' | 'RECOVERY_HMAC',
  activeKeyId: string | undefined,
  rawKeys: string | Record<string, string> | undefined,
): Keyring {
  if (!activeKeyId) {
    throw new Error(`${prefix}_ACTIVE_KEY_ID must be defined.`);
  }

  const keys = Object.fromEntries(
    Object.entries(parseJsonKeyring(`${prefix}_KEYS`, rawKeys)).map(
      ([keyId, key]) => [keyId, parseBase64Key(`${prefix}_KEYS.${keyId}`, key)],
    ),
  );

  if (!keys[activeKeyId]) {
    throw new Error(`${prefix}_ACTIVE_KEY_ID must reference a configured key.`);
  }

  return { activeKeyId, keys };
}

function assertIndependentAuthenticationKeys(
  jwtSecret: string,
  totpEncryption: Keyring,
  recoveryHmac: Keyring,
  throttleHmacKey: Buffer,
) {
  const purposeKeys = [
    ...Object.entries(totpEncryption.keys).map(([keyId, key]) => ({
      purpose: 'TOTP encryption',
      keyId,
      key,
    })),
    ...Object.entries(recoveryHmac.keys).map(([keyId, key]) => ({
      purpose: 'recovery HMAC',
      keyId,
      key,
    })),
    {
      purpose: 'authentication throttle HMAC',
      keyId: 'configured',
      key: throttleHmacKey,
    },
  ];

  for (let index = 0; index < purposeKeys.length; index += 1) {
    for (let other = index + 1; other < purposeKeys.length; other += 1) {
      const left = purposeKeys[index];
      const right = purposeKeys[other];
      if (left.purpose !== right.purpose && left.key.equals(right.key)) {
        throw new Error(
          `${left.purpose} (${left.keyId}) and ${right.purpose} (${right.keyId}) must use independent key material.`,
        );
      }
    }
  }

  const jwtCandidates = [Buffer.from(jwtSecret, 'utf8')];
  const decodedJwtSecret = Buffer.from(jwtSecret, 'base64');
  if (
    decodedJwtSecret.length > 0 &&
    decodedJwtSecret.toString('base64') === jwtSecret
  ) {
    jwtCandidates.push(decodedJwtSecret);
  }

  const reusedWithJwt = purposeKeys.find(({ key }) =>
    jwtCandidates.some((candidate) => candidate.equals(key)),
  );
  if (reusedWithJwt) {
    throw new Error(
      `JWT signing and ${reusedWithJwt.purpose} (${reusedWithJwt.keyId}) must use independent key material.`,
    );
  }
}

export default () => {
  const port = Number(process.env.PORT ?? 3000);
  const apiPrefix = process.env.API_PREFIX ?? 'api/v1';
  const secretsFilePath =
    process.env.SECRETS_FILE_PATH ?? 'config/secrets/local.json';
  const databaseName = process.env.MONGO_DB_NAME;

  if (!databaseName) {
    throw new Error(
      'MONGO_DB_NAME must be defined in the environment configuration.',
    );
  }

  const secrets = readSecretsFile(secretsFilePath);
  const jwtSecret = secrets.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET must be defined in the secrets file.');
  }

  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  const totpEncryption = buildKeyring(
    'TOTP_ENCRYPTION',
    secrets.TOTP_ENCRYPTION_ACTIVE_KEY_ID,
    secrets.TOTP_ENCRYPTION_KEYS,
  );
  const recoveryHmac = buildKeyring(
    'RECOVERY_HMAC',
    secrets.RECOVERY_HMAC_ACTIVE_KEY_ID,
    secrets.RECOVERY_HMAC_KEYS,
  );
  const throttleHmacKeyValue = secrets.AUTH_THROTTLE_HMAC_KEY;
  if (!throttleHmacKeyValue) {
    throw new Error('AUTH_THROTTLE_HMAC_KEY must be defined.');
  }
  const throttleHmacKey = parseBase64Key(
    'AUTH_THROTTLE_HMAC_KEY',
    throttleHmacKeyValue,
  );
  assertIndependentAuthenticationKeys(
    jwtSecret,
    totpEncryption,
    recoveryHmac,
    throttleHmacKey,
  );

  return {
    app: {
      port,
      apiPrefix,
      secretsFilePath,
      trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    },
    mongo: {
      dbName: databaseName,
      uri: buildMongoUri(secrets, databaseName),
    },
    jwt: {
      secret: jwtSecret,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '60m',
    },
    security: {
      totpEncryption,
      recoveryHmac,
      throttleHmacKey,
    },
    twoFactor: {
      enrollmentEnabled: parseBoolean(
        process.env.TOTP_ENROLLMENT_ENABLED,
        false,
      ),
      issuer: process.env.TOTP_ISSUER ?? 'Babki',
      setupTtlSeconds: 600,
      challengeTtlSeconds: 300,
    },
    authLimits: {
      windowSeconds: parsePositiveInteger(
        process.env.AUTH_LIMIT_WINDOW_SECONDS,
        900,
      ),
      blockSeconds: parsePositiveInteger(
        process.env.AUTH_LIMIT_BLOCK_SECONDS,
        900,
      ),
      passwordEmailFailures: parsePositiveInteger(
        process.env.AUTH_PASSWORD_EMAIL_FAILURES,
        5,
      ),
      passwordIpFailures: parsePositiveInteger(
        process.env.AUTH_PASSWORD_IP_FAILURES,
        50,
      ),
      challengeFailures: parsePositiveInteger(
        process.env.AUTH_CHALLENGE_FAILURES,
        5,
      ),
      secondFactorFailures: parsePositiveInteger(
        process.env.AUTH_SECOND_FACTOR_FAILURES,
        10,
      ),
    },
    userDeletion: {
      enabled: parseBoolean(process.env.USER_DELETION_ENABLED, false),
      leaseSeconds: parsePositiveInteger(
        process.env.USER_DELETION_LEASE_SECONDS,
        300,
      ),
    },
  };
};
