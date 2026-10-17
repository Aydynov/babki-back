import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createConnection } from 'mongoose';
import configuration from '../config/configuration';
import { backfillDebtOwners } from './integrity/debt-owner-backfill';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => arg !== '--apply' && arg !== '--dry-run') ||
    (args.includes('--apply') && args.includes('--dry-run'))
  ) {
    throw new Error(
      'Usage: npm run maintenance:debt-owners -- [--dry-run | --apply]',
    );
  }
  await ConfigModule.forRoot({ load: [configuration] });
  const config = configuration();
  const settings = new ConfigService(config);
  const connection = await createConnection(
    settings.getOrThrow<string>('mongo.uri'),
    { autoIndex: false },
  ).asPromise();
  try {
    const result = await backfillDebtOwners(connection, {
      apply: args.includes('--apply'),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.issues.length) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}
void main().catch(() => {
  // Driver errors can contain credentials/URIs. Keep CLI failure output safe.
  console.error(
    'Debt owner maintenance failed; check configuration and database availability.',
  );
  process.exitCode = 1;
});
