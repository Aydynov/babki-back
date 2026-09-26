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

export async function runSeeders(app: INestApplicationContext) {
  const connection = app.get<Connection>(getConnectionToken());
  const anchorDate = new Date();
  await clearDatabase(connection);

  const { userId, users, password } = await seedUsers(app);
  console.log(`👤 Users seeded  (5 total, password: ${password})`);

  const {
    balanceAccountId,
    savingAccountId,
    usdBalanceAccountId,
    usdSavingAccountId,
  } = await seedAccounts(app, userId);
  console.log(
    `🏦 Accounts seeded  (balance: ${balanceAccountId}, saving: ${savingAccountId})`,
  );

  const deletionCandidateAccounts = await seedAccounts(
    app,
    users.deletionCandidate,
    { archiveSaving: true },
  );
  console.log(
    `🧪 Deletion candidate  (email: delete-me@test.com, deletable account: ${deletionCandidateAccounts.balanceAccountId}, archived account: ${deletionCandidateAccounts.savingAccountId})`,
  );

  const categories = await seedCategories(app, userId);
  console.log(
    `🏷️  Categories seeded  (${Object.keys(categories).length} total)`,
  );

  await seedTransactions(
    app,
    userId,
    balanceAccountId,
    savingAccountId,
    usdBalanceAccountId,
    usdSavingAccountId,
    categories,
    anchorDate,
  );
  console.log('💸 Transactions seeded  (116 active, 1 soft-deleted)');

  await seedLimits(app, userId, categories, anchorDate);
  console.log('📊 Limits seeded  (2 total)');

  await seedDebts(app, userId, balanceAccountId, anchorDate);
  console.log('💳 Debts seeded  (active with history, archived, deletable)');

  await seedPlans(app, userId, balanceAccountId, categories, anchorDate);
  console.log('📋 Plans seeded  (7 total)');

  const groupFixtures = await seedGroups(app, users, anchorDate);
  console.log(
    '👥 Groups seeded  (family, 2 organizations, empty budget, deleted history)',
  );
  console.log(`✉️  Pending invitation token: ${groupFixtures.invitationToken}`);
}
