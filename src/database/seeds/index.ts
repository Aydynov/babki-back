import { INestApplicationContext } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { seedUsers } from './01-users';
import { seedAccounts } from './02-accounts';
import { seedCategories } from './03-categories';
import { seedTransactions } from './05-transactions';
import { seedLimits } from './04-limits';
import { seedDebts } from './06-debts';
import { seedPlans } from './07-plans';
import { seedGroups } from './08-groups';

const COLLECTIONS = [
  'users',
  'accounts',
  'accountsnapshots',
  'transactions',
  'expensecategories',
  'expenselimits',
  'debts',
  'debttransactions',
  'plans',
  'groups',
  'groupmemberships',
  'groupmembershipevents',
  'groupinvitations',
  'groupinvitationratelimits',
];

async function clearDatabase(connection: Connection) {
  for (const name of COLLECTIONS) {
    await connection.collection(name).deleteMany({});
  }
  console.log('🗑️  Database cleared');
}

export async function runSeeders(app: INestApplicationContext) {
  const connection = app.get<Connection>(getConnectionToken());
  const anchorDate = new Date();
  await clearDatabase(connection);

  const { userId, users, password } = await seedUsers(app);
  console.log(`👤 Users seeded  (4 total, password: ${password})`);

  const { balanceAccountId, savingAccountId } = await seedAccounts(app, userId);
  console.log(
    `🏦 Accounts seeded  (balance: ${balanceAccountId}, saving: ${savingAccountId})`,
  );

  const categories = await seedCategories(app, userId);
  console.log(
    `🏷️  Categories seeded  (${Object.keys(categories).length} total)`,
  );

  await seedTransactions(app, userId, balanceAccountId, categories, anchorDate);
  console.log('💸 Transactions seeded  (116 total)');

  await seedLimits(app, userId, categories, anchorDate);
  console.log('📊 Limits seeded  (2 total)');

  await seedDebts(app, userId, anchorDate);
  console.log('💳 Debts seeded  (2 total)');

  await seedPlans(app, userId, categories, anchorDate);
  console.log('📋 Plans seeded  (7 total)');

  const groupFixtures = await seedGroups(app, users, anchorDate);
  console.log('👥 Groups seeded  (family, 2 organizations, empty budget)');
  console.log(`✉️  Pending invitation token: ${groupFixtures.invitationToken}`);
}
