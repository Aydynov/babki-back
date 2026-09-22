import 'reflect-metadata';
import { getConnectionToken } from '@nestjs/mongoose';
import { NestFactory } from '@nestjs/core';
import { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';
import {
  auditExitCode,
  runIntegrityAudit,
} from '../src/database/integrity/integrity-audit';
import { MongooseIntegrityReader } from '../src/database/integrity/mongoose-integrity-reader';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const result = await runIntegrityAudit(
      new MongooseIntegrityReader(connection),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = auditExitCode(result);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: 'integrity_audit_failed', name })}\n`,
  );
  process.exitCode = 2;
});
