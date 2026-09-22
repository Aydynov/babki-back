import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type EnvironmentCase = {
  envFile: string;
  secretFile: string;
  expectedSecretPath: string;
  requiredEnvironmentKeys: string[];
  expectedSecretKeys: string[];
};

describe('runtime configuration files', () => {
  const commonEnvironmentKeys = [
    'API_PREFIX',
    'AUTH_CHALLENGE_FAILURES',
    'AUTH_LIMIT_BLOCK_SECONDS',
    'AUTH_LIMIT_WINDOW_SECONDS',
    'AUTH_PASSWORD_EMAIL_FAILURES',
    'AUTH_PASSWORD_IP_FAILURES',
    'AUTH_SECOND_FACTOR_FAILURES',
    'JWT_EXPIRES_IN',
    'MONGO_DB_NAME',
    'NODE_ENV',
    'PORT',
    'SECRETS_FILE_PATH',
    'TOTP_ENROLLMENT_ENABLED',
    'TOTP_ISSUER',
    'TRUST_PROXY',
    'TZ',
    'USER_DELETION_ENABLED',
    'USER_DELETION_LEASE_SECONDS',
  ];
  const mongoTopologyKeys = [
    'MONGO_AUTH_ENABLED',
    'MONGO_AUTH_SOURCE',
    'MONGO_HOST',
    'MONGO_PORT',
    'MONGO_REPLICA_SET',
  ];
  const authenticationSecretKeys = [
    'AUTH_THROTTLE_HMAC_KEY',
    'JWT_SECRET',
    'RECOVERY_HMAC_ACTIVE_KEY_ID',
    'RECOVERY_HMAC_KEYS',
    'TOTP_ENCRYPTION_ACTIVE_KEY_ID',
    'TOTP_ENCRYPTION_KEYS',
  ];
  const cases: EnvironmentCase[] = [
    {
      envFile: '.env.example',
      secretFile: 'config/secrets/example.json',
      expectedSecretPath: 'config/secrets/local.json',
      requiredEnvironmentKeys: [...commonEnvironmentKeys, ...mongoTopologyKeys],
      expectedSecretKeys: authenticationSecretKeys,
    },
    {
      envFile: '.env.docker.example',
      secretFile: 'config/secrets/docker-compose.example.json',
      expectedSecretPath: 'config/secrets/docker-compose.local.json',
      requiredEnvironmentKeys: [...commonEnvironmentKeys, ...mongoTopologyKeys],
      expectedSecretKeys: authenticationSecretKeys,
    },
    {
      envFile: '.env.production.example',
      secretFile: 'config/secrets/production.example.json',
      expectedSecretPath: 'config/secrets/production.json',
      requiredEnvironmentKeys: commonEnvironmentKeys,
      expectedSecretKeys: [...authenticationSecretKeys, 'MONGO_URI'],
    },
  ];

  it.each(cases)(
    '$envFile and $secretFile form a complete non-overlapping pair',
    ({
      envFile,
      secretFile,
      expectedSecretPath,
      requiredEnvironmentKeys,
      expectedSecretKeys,
    }) => {
      const environment = parseEnv(envFile);
      const secrets = JSON.parse(
        readFileSync(resolve(secretFile), 'utf8'),
      ) as Record<string, unknown>;
      const environmentKeys = Object.keys(environment);
      const secretKeys = Object.keys(secrets);

      expect(environment.SECRETS_FILE_PATH).toBe(expectedSecretPath);
      expect(environmentKeys).not.toContain('BABKI_API_IMAGE');
      expect(environmentKeys).not.toContain('DOCKER_SECRETS_FILE');
      expect(environmentKeys.sort()).toEqual(
        [...requiredEnvironmentKeys].sort(),
      );
      expect(secretKeys.sort()).toEqual([...expectedSecretKeys].sort());
      expect(environmentKeys.filter((key) => secretKeys.includes(key))).toEqual(
        [],
      );
    },
  );

  it('renders the API port, healthcheck, and secrets mount from Docker env files', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'babki-compose-config-'));
    const secretsPath = 'config/secrets/runtime.json';
    const dockerEnvironment = readFileSync(
      resolve('.env.docker.example'),
      'utf8',
    )
      .replace('PORT=5001', 'PORT=5123')
      .replace('API_PREFIX=api/v1', 'API_PREFIX=custom/v2')
      .replace(
        'SECRETS_FILE_PATH=config/secrets/docker-compose.local.json',
        `SECRETS_FILE_PATH=${secretsPath}`,
      );

    try {
      writeFileSync(
        join(tempDir, 'docker-compose.yml'),
        readFileSync(resolve('docker-compose.yml'), 'utf8'),
      );
      writeFileSync(join(tempDir, '.env'), dockerEnvironment);
      writeFileSync(join(tempDir, '.env.docker'), dockerEnvironment);
      mkdirSync(join(tempDir, 'config/secrets'), { recursive: true });
      writeFileSync(join(tempDir, secretsPath), '{}\n');

      const result = spawnSync(
        'docker',
        ['compose', 'config', '--format', 'json'],
        { cwd: tempDir, encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      const rendered = JSON.parse(result.stdout) as {
        services: {
          api: {
            environment: Record<string, string>;
            healthcheck: { test: string[] };
            image?: string;
            ports: Array<{ published: string; target: number }>;
            volumes: Array<{
              read_only: boolean;
              source: string;
              target: string;
              type: string;
            }>;
          };
        };
      };
      const api = rendered.services.api;

      expect(api.image).toBeUndefined();
      expect(api.environment).toMatchObject({
        API_PREFIX: 'custom/v2',
        PORT: '5123',
        SECRETS_FILE_PATH: secretsPath,
      });
      expect(api.ports).toContainEqual(
        expect.objectContaining({ published: '5123', target: 5123 }),
      );
      expect(api.healthcheck.test).toContain('http://127.0.0.1:5123/custom/v2');
      expect(api.volumes).toContainEqual(
        expect.objectContaining({
          read_only: true,
          source: join(realpathSync(tempDir), secretsPath),
          target: `/app/${secretsPath}`,
          type: 'bind',
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function parseEnv(filePath: string) {
    return Object.fromEntries(
      readFileSync(resolve(filePath), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  }
});
