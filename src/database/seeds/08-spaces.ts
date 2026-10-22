import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { SpaceDebtsService } from '../../modules/space-finances/space-debts.service';
import { SpacePlansService } from '../../modules/space-finances/space-plans.service';
import { SpaceTransfersService } from '../../modules/space-finances/space-transfers.service';
import { SpaceSettingsService } from '../../modules/space-finances/space-settings.service';
import { SpaceTransactionsService } from '../../modules/space-finances/space-transactions.service';
import { SpaceWalletService } from '../../modules/space-finances/space-wallet.service';
import { SpacesService } from '../../modules/spaces/spaces.service';
import { SpaceInvitation } from '../../modules/spaces/schemas/space-invitation.schema';
import { SpaceMembershipEvent } from '../../modules/spaces/schemas/space-membership-event.schema';
import { SpaceMembership } from '../../modules/spaces/schemas/space-membership.schema';
import { getSeedDate, getSeedMonthRange } from './seed-date.utils';
export type SeedUserMap = {
  alex: string;
  maria: string;
  ivan: string;
  elena: string;
};
type SpaceFixture = {
  id: string;
  ownerId: string;
  accountId?: string;
  categories: Record<string, string>;
};
export async function seedSpaces(
  app: INestApplicationContext,
  users: SeedUserMap,
  anchorDate: Date,
) {
  const spaces = app.get(SpacesService);
  const wallets = app.get(SpaceWalletService);
  const settings = app.get(SpaceSettingsService);
  const transactions = app.get(SpaceTransactionsService);
  const memberships = app.get<Model<SpaceMembership>>(
    getModelToken(SpaceMembership.name),
  );
  const events = app.get<Model<SpaceMembershipEvent>>(
    getModelToken(SpaceMembershipEvent.name),
  );
  const invitations = app.get<Model<SpaceInvitation>>(
    getModelToken(SpaceInvitation.name),
  );
  const family = await createSpace(spaces, users.alex, 'Семья Тестовых');
  await addMembers(
    memberships,
    family.id,
    [
      {
        userId: users.maria,
        permissions: {
          manageAccounts: true,
          manageCategories: true,
          manageLimits: true,
        },
      },
      {
        userId: users.ivan,
        permissions: {
          manageAccounts: false,
          manageCategories: false,
          manageLimits: true,
        },
      },
      { userId: users.elena },
    ],
    anchorDate,
  );
  await seedFamilyFinances(
    wallets,
    settings,
    transactions,
    app.get(SpaceTransfersService),
    app.get(SpacePlansService),
    app.get(SpaceDebtsService),
    family,
    users,
    anchorDate,
  );
  const endedAt = getSeedDate(0, 20, anchorDate);
  await memberships.updateOne(
    { spaceId: family.id, userId: users.elena },
    {
      $set: {
        status: 'left',
        endReason: 'member_left',
        endedAt,
        permissions: emptyPermissions(),
      },
    },
  );
  await events.create({
    spaceId: family.id,
    userId: users.elena,
    actorId: users.elena,
    kind: 'left',
    occurredAt: endedAt,
    before: emptyPermissions(),
    after: emptyPermissions(),
  });
  const studio = await createSpace(spaces, users.ivan, 'North Studio');
  await addMembers(
    memberships,
    studio.id,
    [
      {
        userId: users.alex,
        permissions: {
          manageAccounts: false,
          manageCategories: true,
          manageLimits: false,
        },
      },
      { userId: users.maria },
    ],
    anchorDate,
  );
  await seedOrganizationFinances(
    wallets,
    settings,
    transactions,
    studio,
    users.alex,
    anchorDate,
    'Подписки',
    420000,
    18900,
  );
  const agency = await createSpace(spaces, users.elena, 'South Agency');
  await addMembers(
    memberships,
    agency.id,
    [
      { userId: users.alex },
      {
        userId: users.ivan,
        permissions: {
          manageAccounts: true,
          manageCategories: false,
          manageLimits: true,
        },
      },
    ],
    anchorDate,
  );
  await seedOrganizationFinances(
    wallets,
    settings,
    transactions,
    agency,
    users.alex,
    anchorDate,
    'Командировки',
    275000,
    32750,
  );
  const sandbox = await createSpace(spaces, users.alex, 'Пустой бюджет');
  const invitationToken = createHash('sha256')
    .update('babki-development-seed-invitation')
    .digest('base64url');
  await invitations.create({
    spaceId: sandbox.id,
    createdBy: users.alex,
    tokenDigest: createHash('sha256').update(invitationToken).digest('hex'),
    expiresAt: new Date(anchorDate.getTime() + 30 * 86400000),
    status: 'pending',
  });
  const deleted = await createSpace(
    spaces,
    users.maria,
    'Deletion test: deleted space',
  );
  await addMembers(
    memberships,
    deleted.id,
    [{ userId: users.alex }],
    anchorDate,
  );
  await seedOrganizationFinances(
    wallets,
    settings,
    transactions,
    deleted,
    users.alex,
    anchorDate,
    'Историческая категория',
    50000,
    12500,
  );
  await invitations.create({
    spaceId: deleted.id,
    createdBy: users.maria,
    tokenDigest: createHash('sha256')
      .update('babki-development-deleted-space-invitation')
      .digest('hex'),
    expiresAt: new Date(anchorDate.getTime() + 30 * 86400000),
    status: 'pending',
  });
  await spaces.remove(users.maria, deleted.id);
  return {
    family,
    studio,
    agency,
    sandbox,
    deleted,
    invitationToken,
  };
}
async function createSpace(
  spaces: SpacesService,
  ownerId: string,
  name: string,
): Promise<SpaceFixture> {
  const space = await spaces.create(ownerId, {
    name,
    description: 'Development seed data for manual testing',
  });
  return { id: space.id, ownerId, categories: {} };
}
async function addMembers(
  memberships: Model<SpaceMembership>,
  spaceId: string,
  members: Array<{
    userId: string;
    permissions?: ReturnType<typeof emptyPermissions>;
  }>,
  anchorDate: Date,
) {
  await memberships.create(
    members.map((member) => ({
      spaceId,
      userId: member.userId,
      status: 'active',
      joinedAt: new Date(getSeedDate(-2, 1, anchorDate)),
      permissions: member.permissions ?? emptyPermissions(),
    })),
  );
}
async function seedFamilyFinances(
  wallets: SpaceWalletService,
  settings: SpaceSettingsService,
  transactions: SpaceTransactionsService,
  transfers: SpaceTransfersService,
  plans: SpacePlansService,
  debts: SpaceDebtsService,
  space: SpaceFixture,
  users: SeedUserMap,
  anchorDate: Date,
) {
  space.accountId = String(
    (
      await wallets.create(space.id, space.ownerId, {
        name: 'Family',
        currency: 'USD',
        amount: 120000,
        openedAt: getSeedDate(-2, 1, anchorDate),
      })
    )._id,
  );
  await wallets.create(space.id, space.ownerId, {
    name: 'Family bank',
    type: 'balance',
    currency: 'USD',
    amount: 20000,
    openedAt: getSeedDate(-2, 1, anchorDate),
  });
  const reserve = await wallets.create(space.id, space.ownerId, {
    name: 'Family reserve',
    type: 'saving',
    currency: 'USD',
    amount: 50000,
    openedAt: getSeedDate(-2, 1, anchorDate),
  });
  for (const [name, color] of [
    ['Продукты', '#FF6B6B'],
    ['Дом', '#4ECDC4'],
    ['Досуг', '#45B7D1'],
  ] as const) {
    const category = await settings.saveCategory(space.id, space.ownerId, {
      name,
      color,
    });
    space.categories[name] = String(category._id);
  }
  const month = getSeedMonthRange(0, anchorDate);
  await settings.saveLimit(space.id, space.ownerId, {
    currency: 'USD',
    categoryId: space.categories['Продукты'],
    total: 50000,
    startDate: month.startDate,
    endDate: month.endDate,
  });
  await transactions.create(space.id, space.ownerId, 'income', {
    accountId: space.accountId,
    amount: 180000,
    transactionDate: getSeedDate(0, 2, anchorDate),
    description: 'Пополнение семейного бюджета',
  });
  await transactions.create(space.id, users.alex, 'expense', {
    accountId: space.accountId,
    categoryId: space.categories['Продукты'],
    participantId: users.maria,
    amount: 8450.5,
    transactionDate: getSeedDate(0, 5, anchorDate),
    description: 'Покупки за Марию',
    merchant: 'Супермаркет',
  });
  await transactions.create(space.id, users.maria, 'expense', {
    accountId: space.accountId,
    categoryId: space.categories['Дом'],
    amount: 15600,
    transactionDate: getSeedDate(0, 10, anchorDate),
    description: 'Коммунальные услуги',
  });
  await transactions.create(space.id, users.elena, 'expense', {
    accountId: space.accountId,
    categoryId: space.categories['Досуг'],
    amount: 3200,
    transactionDate: getSeedDate(0, 15, anchorDate),
    description: 'Исторический расход бывшего участника',
  });
  await plans.create(space.id, users.maria, {
    description: 'Семейная покупка: запланировано',
    currency: 'USD',
    amount: 2000,
    targetDate: getSeedDate(1, 10, anchorDate),
    categoryId: space.categories['Дом'],
  });
  const completed = await plans.create(space.id, users.alex, {
    description: 'Семейная покупка: исполнено',
    currency: 'USD',
    amount: 1000,
    targetDate: getSeedDate(0, 12, anchorDate),
    categoryId: space.categories['Продукты'],
  });
  await plans.close(space.id, users.alex, String(completed._id), {
    accountId: space.accountId,
    amount: 1200,
    participantId: users.maria,
    closingDate: getSeedDate(0, 12, anchorDate),
  });
  const sharedDebt = await debts.create(space.id, users.maria, {
    debtor: 'Артур',
    principalAmount: 4000,
    currency: 'USD',
    dueDate: getSeedDate(1, 10, anchorDate),
    description: 'Семейный долг с историей погашений',
  });
  await debts.repay(space.id, users.alex, String(sharedDebt._id), {
    amount: 1200,
    isIncome: true,
    accountId: space.accountId,
    repaymentDate: getSeedDate(0, 13, anchorDate),
  });
  await debts.repay(space.id, users.maria, String(sharedDebt._id), {
    amount: 300,
    isIncome: false,
    repaymentDate: getSeedDate(0, 14, anchorDate),
  });
  const reversed = await debts.repay(
    space.id,
    users.maria,
    String(sharedDebt._id),
    {
      amount: 500,
      isIncome: true,
      accountId: space.accountId,
      repaymentDate: getSeedDate(0, 16, anchorDate),
    },
  );
  await debts.cancel(
    space.id,
    users.alex,
    String(sharedDebt._id),
    String(reversed.repayment._id),
  );
  const closedDebt = await debts.create(space.id, users.alex, {
    debtor: 'Ирина',
    principalAmount: 1000,
    currency: 'USD',
    description: 'Семейный долг закрыт без движения денег',
  });
  await debts.repay(space.id, users.alex, String(closedDebt._id), {
    amount: 1000,
    isIncome: false,
    repaymentDate: getSeedDate(0, 17, anchorDate),
  });
  await transfers.create(space.id, space.ownerId, {
    sourceAccountId: space.accountId,
    destinationAccountId: String(reserve._id),
    sourceAmount: 1000,
    destinationAmount: 1000,
    transactionDate: getSeedDate(0, 18, anchorDate),
    description: 'Пополнение семейного резерва',
  });
}
async function seedOrganizationFinances(
  wallets: SpaceWalletService,
  settings: SpaceSettingsService,
  transactions: SpaceTransactionsService,
  space: SpaceFixture,
  actorId: string,
  anchorDate: Date,
  categoryName: string,
  income: number,
  expense: number,
) {
  space.accountId = String(
    (
      await wallets.create(space.id, space.ownerId, {
        name: 'Family',
        currency: 'USD',
        amount: 0,
        openedAt: getSeedDate(-1, 1, anchorDate),
      })
    )._id,
  );
  const category = await settings.saveCategory(space.id, space.ownerId, {
    name: categoryName,
    color: '#7B61FF',
  });
  space.categories[categoryName] = String(category._id);
  await transactions.create(space.id, space.ownerId, 'income', {
    accountId: space.accountId,
    amount: income,
    transactionDate: getSeedDate(0, 1, anchorDate),
    description: 'Операционный бюджет',
  });
  await transactions.create(space.id, actorId, 'expense', {
    accountId: space.accountId,
    categoryId: space.categories[categoryName],
    amount: expense,
    transactionDate: getSeedDate(0, 7, anchorDate),
    description: `Расход ${categoryName.toLowerCase()}`,
  });
}
function emptyPermissions() {
  return {
    manageAccounts: false,
    manageCategories: false,
    manageLimits: false,
  };
}
