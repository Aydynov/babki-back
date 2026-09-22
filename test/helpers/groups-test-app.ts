import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from '../../src/common/interceptors/request-logging.interceptor';
import { startTestReplicaSet } from './mongo-replica';

export async function startGroupsTestApp() {
  const replica = await startTestReplicaSet();
  const secretsPath = `.temp/groups-test-${process.pid}-${randomBytes(4).toString('hex')}.json`;
  const previousEnv = { ...process.env };
  let app: INestApplication | undefined;
  const close = async () => {
    await app?.close();
    await replica.close();
    await rm(secretsPath, { force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    Object.assign(process.env, previousEnv);
  };
  try {
    await mkdir('.temp', { recursive: true });
    await writeFile(
      secretsPath,
      JSON.stringify({
        MONGO_URI: replica.uri,
        JWT_SECRET: randomBytes(48).toString('base64url'),
        TOTP_ENCRYPTION_ACTIVE_KEY_ID: 'test',
        TOTP_ENCRYPTION_KEYS: { test: randomBytes(32).toString('base64') },
        RECOVERY_HMAC_ACTIVE_KEY_ID: 'test',
        RECOVERY_HMAC_KEYS: { test: randomBytes(32).toString('base64') },
        AUTH_THROTTLE_HMAC_KEY: randomBytes(32).toString('base64'),
      }),
      { mode: 0o600 },
    );
    process.env.NODE_ENV = 'test';
    process.env.USER_DELETION_ENABLED = 'true';
    process.env.SECRETS_FILE_PATH = secretsPath;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
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
    app.useGlobalInterceptors(new RequestLoggingInterceptor());
    await app.listen(0, '127.0.0.1');
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    const users: { id: string; token: string }[] = [];
    for (const firstName of ['Ada', 'Grace', 'Linus', 'Margaret']) {
      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/api/v1/auth/register')
        .send({
          firstName,
          lastName: 'Test',
          email: `${firstName.toLowerCase()}@groups.example`,
          password: 'test-only-correct-horse-battery',
          currency: 'USD',
        })
        .expect(201);
      const body = response.body as {
        user: { _id: string };
        accessToken: string;
      };
      users.push({ id: body.user._id, token: body.accessToken });
    }
    return { app, connection, users, close };
  } catch (error) {
    await close();
    throw error;
  }
}
