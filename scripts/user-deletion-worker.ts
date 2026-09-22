import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UserDeletionWorker } from '../src/modules/users/user-deletion.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const worker = app.get(UserDeletionWorker);
    const workerId = `cli-${process.pid}`;
    let processed = 0;
    while (await worker.runOnce(workerId)) processed += 1;
    process.stdout.write(`${JSON.stringify({ processed })}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'User deletion worker failed.'}\n`,
  );
  process.exitCode = 1;
});
