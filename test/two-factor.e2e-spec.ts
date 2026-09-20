/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { startTestReplicaSet } from './helpers/mongo-replica';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TotpService } from '../src/modules/auth/services/totp.service';

describe('TOTP two-factor authentication (e2e)', () => {
  const databaseName = `babki_totp_e2e_${process.pid}`;
  const password = 'correct horse battery staple';
  const secretsPath = `.temp/babki-totp-e2e-${process.pid}.json`;
  let replica: Awaited<ReturnType<typeof startTestReplicaSet>>;
  const previousEnv = { ...process.env };
  let app: INestApplication;
  let connection: Connection;
  let totpService: TotpService;

  beforeAll(async () => {
    replica = await startTestReplicaSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGO_DB_NAME = databaseName;
    process.env.SECRETS_FILE_PATH = secretsPath;
    process.env.TOTP_ENROLLMENT_ENABLED = 'true';
    mkdirSync('.temp', { recursive: true });
    writeFileSync(
      secretsPath,
      JSON.stringify({
        MONGO_URI: replica.uri.replace(
          '/babki_groups_test?',
          `/${databaseName}?`,
        ),
        JWT_SECRET: randomBytes(48).toString('base64url'),
        TOTP_ENCRYPTION_ACTIVE_KEY_ID: 'e2e',
        TOTP_ENCRYPTION_KEYS: {
          e2e: randomBytes(32).toString('base64'),
        },
        RECOVERY_HMAC_ACTIVE_KEY_ID: 'e2e',
        RECOVERY_HMAC_KEYS: {
          e2e: randomBytes(32).toString('base64'),
        },
        AUTH_THROTTLE_HMAC_KEY: randomBytes(32).toString('base64'),
      }),
      { mode: 0o600 },
    );

    await initializeApp();
    expect(app.getHttpServer().listening).toBe(true);
  }, 60_000);

  afterAll(async () => {
    if (connection?.db?.databaseName.startsWith('babki_totp_e2e_')) {
      await connection.db.dropDatabase();
    }
    await app?.close();
    rmSync(secretsPath, { force: true });
    await replica?.close();
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
  }, 30_000);

  it('enforces atomic TOTP and recovery login and revokes the enrollment JWT', async () => {
    const registration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.e2e@example.com',
        password,
        currency: 'USD',
      })
      .expect(201);
    const initialToken = registration.body.accessToken as string;

    const setup = await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup')
      .set('Authorization', `Bearer ${initialToken}`)
      .send({ password })
      .expect(201);
    expect(setup.body).toEqual({
      secret: expect.stringMatching(/^[A-Z2-7]{32}$/),
      otpauthUri: expect.stringMatching(/^otpauth:\/\/totp\//),
      expiresAt: expect.any(String),
    });
    expect(setup.body).not.toHaveProperty('qrCode');

    const secret = setup.body.secret as string;
    const confirmationCode = await totpService.generate(
      secret,
      Math.floor(Date.now() / 1000) - 30,
    );
    const confirmation = await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup/confirm')
      .set('Authorization', `Bearer ${initialToken}`)
      .send({ token: confirmationCode })
      .expect(201);
    expect(confirmation.body.recoveryCodes).toHaveLength(10);
    const recoveryCodes = confirmation.body.recoveryCodes as string[];

    await request(app.getHttpServer())
      .get('/api/v1/auth/two-factor')
      .set('Authorization', `Bearer ${initialToken}`)
      .expect(401);

    const passwordLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    expect(passwordLogin.body).toEqual({
      requiresTwoFactor: true,
      challengeToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: expect.any(String),
    });
    expect(passwordLogin.body).not.toHaveProperty('accessToken');
    expect(passwordLogin.body).not.toHaveProperty('user');

    const secondTotpChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    const epoch = Math.floor(Date.now() / 1000);
    const currentCode = await totpService.generate(secret, epoch);
    const totpAttempts = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/auth/login/two-factor').send({
        challengeToken: passwordLogin.body.challengeToken,
        method: 'totp',
        code: currentCode,
      }),
      request(app.getHttpServer()).post('/api/v1/auth/login/two-factor').send({
        challengeToken: secondTotpChallenge.body.challengeToken,
        method: 'totp',
        code: currentCode,
      }),
    ]);
    expect(totpAttempts.map(({ status }) => status).sort()).toEqual([201, 401]);
    const totpAuthentication = totpAttempts.find(
      ({ status }) => status === 201,
    );
    const preRegenerationToken = totpAuthentication?.body.accessToken as string;

    const nextCode = await totpService.generate(secret, epoch + 30);
    const regeneration = await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/recovery/regenerate')
      .set('Authorization', `Bearer ${preRegenerationToken}`)
      .send({ password, token: nextCode })
      .expect(201);
    expect(regeneration.body.recoveryCodes).toHaveLength(10);
    const regeneratedCodes = regeneration.body.recoveryCodes as string[];
    const managementToken = regeneration.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/api/v1/auth/two-factor')
      .set('Authorization', `Bearer ${preRegenerationToken}`)
      .expect(401);

    const firstRecoveryChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    const secondRecoveryChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    const recoveryAttempts = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/auth/login/two-factor').send({
        challengeToken: firstRecoveryChallenge.body.challengeToken,
        method: 'recovery',
        code: regeneratedCodes[0],
      }),
      request(app.getHttpServer()).post('/api/v1/auth/login/two-factor').send({
        challengeToken: secondRecoveryChallenge.body.challengeToken,
        method: 'recovery',
        code: regeneratedCodes[0],
      }),
    ]);
    expect(recoveryAttempts.map(({ status }) => status).sort()).toEqual([
      201, 401,
    ]);

    const singleUseChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    const challengeAttempts = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/auth/login/two-factor').send({
        challengeToken: singleUseChallenge.body.challengeToken,
        method: 'recovery',
        code: regeneratedCodes[1],
      }),
      request(app.getHttpServer()).post('/api/v1/auth/login/two-factor').send({
        challengeToken: singleUseChallenge.body.challengeToken,
        method: 'recovery',
        code: regeneratedCodes[2],
      }),
    ]);
    expect(challengeAttempts.map(({ status }) => status).sort()).toEqual([
      201, 401,
    ]);

    const authenticated = challengeAttempts.find(
      ({ status }) => status === 201,
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/two-factor')
      .set(
        'Authorization',
        `Bearer ${authenticated?.body.accessToken as string}`,
      )
      .expect(200)
      .expect({ status: 'enabled', recoveryCodesRemaining: 8 });

    const invalidRecoveryChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    const invalidRecovery = await request(app.getHttpServer())
      .post('/api/v1/auth/login/two-factor')
      .send({
        challengeToken: invalidRecoveryChallenge.body.challengeToken,
        method: 'recovery',
        code: recoveryCodes[1],
      })
      .expect(401);
    const replayedChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login/two-factor')
      .send({
        challengeToken: singleUseChallenge.body.challengeToken,
        method: 'recovery',
        code: regeneratedCodes[4],
      })
      .expect(401);
    expect(replayedChallenge.body).toMatchObject({
      statusCode: invalidRecovery.body.statusCode,
      error: invalidRecovery.body.error,
    });

    const disabling = await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/disable')
      .set('Authorization', `Bearer ${managementToken}`)
      .send({
        password,
        method: 'recovery',
        code: regeneratedCodes[3],
      })
      .expect(201);
    const disabledToken = disabling.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/api/v1/auth/two-factor')
      .set('Authorization', `Bearer ${managementToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/two-factor')
      .set('Authorization', `Bearer ${disabledToken}`)
      .expect(200)
      .expect({ status: 'disabled', recoveryCodesRemaining: 0 });

    const passwordOnlyLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada.e2e@example.com', password })
      .expect(201);
    expect(passwordOnlyLogin.body).toEqual({
      accessToken: expect.any(String),
      user: expect.objectContaining({ email: 'ada.e2e@example.com' }),
    });
  }, 60_000);

  it('persists factor blocks across restart and keeps rollout gating narrow', async () => {
    const pendingRegistration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'pending.e2e@example.com',
        password,
        currency: 'USD',
      })
      .expect(201);
    const pendingToken = pendingRegistration.body.accessToken as string;
    const pendingSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ password })
      .expect(201);

    const blockedRegistration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Katherine',
        lastName: 'Johnson',
        email: 'blocked.e2e@example.com',
        password,
        currency: 'USD',
      })
      .expect(201);
    const blockedInitialToken = blockedRegistration.body.accessToken as string;
    const blockedSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup')
      .set('Authorization', `Bearer ${blockedInitialToken}`)
      .send({ password })
      .expect(201);
    const blockedSecret = blockedSetup.body.secret as string;
    const blockedConfirmationCode = await totpService.generate(
      blockedSecret,
      Math.floor(Date.now() / 1000) - 30,
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup/confirm')
      .set('Authorization', `Bearer ${blockedInitialToken}`)
      .send({ token: blockedConfirmationCode })
      .expect(201);

    const validTokens = await Promise.all(
      [-30, 0, 30].map((offset) =>
        totpService.generate(
          blockedSecret,
          Math.floor(Date.now() / 1000) + offset,
        ),
      ),
    );
    const invalidCode = ['000000', '111111', '222222', '333333'].find(
      (candidate) => !validTokens.includes(candidate),
    ) as string;

    for (let challengeIndex = 0; challengeIndex < 2; challengeIndex += 1) {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'blocked.e2e@example.com', password })
        .expect(201);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login/two-factor')
          .send({
            challengeToken: challenge.body.challengeToken,
            method: 'totp',
            code: invalidCode,
          })
          .expect(401);
      }
    }

    const blockedChallenge = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'blocked.e2e@example.com', password })
      .expect(201);
    const blockedResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login/two-factor')
      .send({
        challengeToken: blockedChallenge.body.challengeToken,
        method: 'totp',
        code: validTokens[1],
      })
      .expect(429);
    expect(Number(blockedResponse.headers['retry-after'])).toBeGreaterThan(0);

    await app.close();
    process.env.TOTP_ENROLLMENT_ENABLED = 'false';
    await initializeApp();

    const persistedBlock = await request(app.getHttpServer())
      .post('/api/v1/auth/login/two-factor')
      .send({
        challengeToken: blockedChallenge.body.challengeToken,
        method: 'totp',
        code: validTokens[1],
      })
      .expect(429);
    expect(Number(persistedBlock.headers['retry-after'])).toBeGreaterThan(0);

    const enabledLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'blocked.e2e@example.com', password })
      .expect(201);
    expect(enabledLogin.body).toEqual({
      requiresTwoFactor: true,
      challengeToken: expect.any(String),
      expiresAt: expect.any(String),
    });

    const pendingCode = await totpService.generate(
      pendingSetup.body.secret as string,
      Math.floor(Date.now() / 1000),
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup/confirm')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ token: pendingCode })
      .expect(201);

    const gatedRegistration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Dorothy',
        lastName: 'Vaughan',
        email: 'gated.e2e@example.com',
        password,
        currency: 'USD',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/two-factor/setup')
      .set(
        'Authorization',
        `Bearer ${gatedRegistration.body.accessToken as string}`,
      )
      .send({ password })
      .expect(503);
  }, 60_000);

  async function initializeApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    connection = app.get<Connection>(getConnectionToken());
    totpService = app.get(TotpService);
  }
});
