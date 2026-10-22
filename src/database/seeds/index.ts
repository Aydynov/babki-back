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
import { SpaceWalletService } from '../../modules/space-finances/space-wallet.service';
import { SpacesService } from '../../modules/spaces/spaces.service';
import { seedSpaces } from './08-spaces';
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
  'spaces',
  'spacememberships',
  'spacemembershipevents',
  'spaceinvitations',
  'spaceinvitationratelimits',
  'userdeletionjobs',
  'authchallenges',
  'authratelimits',
  'securityauditevents',
  'usertwofactors',
];
async function clearDatabase(connection: Connection) {
  for (const name of COLLECTIONS) {
    await connection.collection(name).deleteMany({});
  }
  console.log('🗑️  Database cleared');
}
export async function runSeeders(
  app: INestApplicationContext,
  anchorDate = new Date(),
) {
  const connection = app.get<Connection>(getConnectionToken());
  await clearDatabase(connection);
  const { userId, users, password } = await seedUsers(app);
  console.log(`👤 Users seeded  (5 total, password: ${password})`);
  const solo = await app.get(SpacesService).create(userId, {
    name: 'Личный бюджет',
    description: 'Single-member development space',
  });
  const {
    balanceAccountId,
    savingAccountId,
    usdBalanceAccountId,
    usdSavingAccountId,
  } = await seedAccounts(app, userId, solo.id, anchorDate);
  console.log(
    `🏦 Accounts seeded  (balance: ${balanceAccountId}, saving: ${savingAccountId})`,
  );
  const categories = await seedCategories(app, userId, solo.id);
  console.log(
    `🏷️  Categories seeded  (${Object.keys(categories).length} total)`,
  );
  await seedTransactions(
    app,
    userId,
    solo.id,
    balanceAccountId,
    savingAccountId,
    usdBalanceAccountId,
    usdSavingAccountId,
    categories,
    anchorDate,
  );
  console.log(
    '💸 Transactions seeded  (20-month transaction history, including soft deletion)',
  );
  await seedLimits(app, userId, solo.id, categories, anchorDate);
  console.log('📊 Limits seeded  (3 total)');
  await seedDebts(app, userId, solo.id, anchorDate);
  console.log('💳 Debts seeded  (active with history, archived, deletable)');
  await seedPlans(
    app,
    userId,
    solo.id,
    balanceAccountId,
    categories,
    anchorDate,
  );
  await app.get(SpaceWalletService).archive(solo.id, userId, savingAccountId);
  console.log('📋 Plans seeded  (8 total)');
  const spaceFixtures = await seedSpaces(app, users, anchorDate);
  console.log(
    '👥 Spaces seeded  (single-member, shared, empty, deleted history)',
  );
  console.log(`✉️  Pending invitation token: ${spaceFixtures.invitationToken}`);
  return { users, solo, spaces: spaceFixtures };
}
