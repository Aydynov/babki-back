import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UserDeletionWorker } from '../src/modules/users/user-deletion.service';

async function main() {
  const userId = process.env.USER_ID;
  if (!userId) throw new Error('USER_ID must be defined.');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const report = await app.get(UserDeletionWorker).diagnose(userId);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'User deletion dry-run failed.'}\n`,
  );
  process.exitCode = 1;
});
