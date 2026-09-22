import 'reflect-metadata';
import { getConnectionToken } from '@nestjs/mongoose';
import { NestFactory } from '@nestjs/core';
import { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';
import { runLifecycleMigration } from '../src/database/integrity/lifecycle-migration';
import { MongooseLifecycleMigrationStore } from '../src/database/integrity/mongoose-lifecycle-migration-store';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const result = await runLifecycleMigration(
      new MongooseLifecycleMigrationStore(connection),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: 'lifecycle_migration_failed', name })}\n`,
  );
  process.exitCode = 2;
});
