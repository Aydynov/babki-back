import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
import { GroupSettingsService } from '../../modules/group-finances/group-settings.service';
import { GroupTransactionsService } from '../../modules/group-finances/group-transactions.service';
import { GroupWalletService } from '../../modules/group-finances/group-wallet.service';
import { GroupsService } from '../../modules/groups/groups.service';
import { GroupInvitation } from '../../modules/groups/schemas/group-invitation.schema';
import { GroupMembershipEvent } from '../../modules/groups/schemas/group-membership-event.schema';
import { GroupMembership } from '../../modules/groups/schemas/group-membership.schema';
import { getSeedDate, getSeedMonthRange } from './seed-date.utils';

export type SeedUserMap = {
  alex: string;
  maria: string;
  ivan: string;
  elena: string;
};

type GroupFixture = {
  id: string;
  ownerId: string;
  accountId?: string;
  categories: Record<string, string>;
};

export async function seedGroups(
  app: INestApplicationContext,
  users: SeedUserMap,
  anchorDate: Date,
) {
  const groups = app.get(GroupsService);
  const wallets = app.get(GroupWalletService);
  const settings = app.get(GroupSettingsService);
  const transactions = app.get(GroupTransactionsService);
  const memberships = app.get<Model<GroupMembership>>(
    getModelToken(GroupMembership.name),
  );
  const events = app.get<Model<GroupMembershipEvent>>(
    getModelToken(GroupMembershipEvent.name),
  );
  const invitations = app.get<Model<GroupInvitation>>(
    getModelToken(GroupInvitation.name),
  );

  const family = await createGroup(
    groups,
    users.alex,
    'Семья Тестовых',
    'family',
  );
  await addMembers(memberships, family.id, [
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
  ]);
  await seedFamilyFinances(
    wallets,
    settings,
    transactions,
    family,
    users,
    anchorDate,
  );
  const endedAt = getSeedDate(0, 20, anchorDate);
  await memberships.updateOne(
    { groupId: family.id, userId: users.elena },
    {
      $set: {
        status: 'left',
        endedAt,
        permissions: emptyPermissions(),
      },
    },
  );
  await events.create({
    groupId: family.id,
    userId: users.elena,
    actorId: users.elena,
    kind: 'left',
    occurredAt: endedAt,
    before: emptyPermissions(),
    after: emptyPermissions(),
  });

  const studio = await createGroup(
    groups,
    users.ivan,
    'North Studio',
    'organization',
  );
  await addMembers(memberships, studio.id, [
    {
      userId: users.alex,
      permissions: {
        manageAccounts: false,
        manageCategories: true,
        manageLimits: false,
      },
    },
    { userId: users.maria },
  ]);
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

  const agency = await createGroup(
    groups,
    users.elena,
    'South Agency',
    'organization',
  );
  await addMembers(memberships, agency.id, [
    { userId: users.alex },
    {
      userId: users.ivan,
      permissions: {
        manageAccounts: true,
        manageCategories: false,
        manageLimits: true,
      },
    },
  ]);
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

  const sandbox = await createGroup(
    groups,
    users.alex,
    'Пустой бюджет',
    'organization',
  );
  const invitationToken = createHash('sha256')
    .update('babki-development-seed-invitation')
    .digest('base64url');
  await invitations.create({
    groupId: sandbox.id,
    createdBy: users.alex,
    tokenDigest: createHash('sha256').update(invitationToken).digest('hex'),
    expiresAt: new Date(anchorDate.getTime() + 30 * 86400000),
    status: 'pending',
  });

  const deleted = await createGroup(
    groups,
    users.maria,
    'Deletion test: deleted group',
    'organization',
  );
  await addMembers(memberships, deleted.id, [{ userId: users.alex }]);
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
    groupId: deleted.id,
    createdBy: users.maria,
    tokenDigest: createHash('sha256')
      .update('babki-development-deleted-group-invitation')
      .digest('hex'),
    expiresAt: new Date(anchorDate.getTime() + 30 * 86400000),
    status: 'pending',
  });
  await groups.remove(users.maria, deleted.id);

  return {
    family,
    studio,
    agency,
    sandbox,
    deleted,
    invitationToken,
  };
}

async function createGroup(
  groups: GroupsService,
  ownerId: string,
  name: string,
  type: 'family' | 'organization',
): Promise<GroupFixture> {
  const group = await groups.create(ownerId, {
    name,
    type,
    description: 'Development seed data for manual testing',
  });
  return { id: group.id, ownerId, categories: {} };
}

async function addMembers(
  memberships: Model<GroupMembership>,
  groupId: string,
  members: Array<{
    userId: string;
    permissions?: ReturnType<typeof emptyPermissions>;
  }>,
) {
  await memberships.create(
    members.map((member) => ({
      groupId,
      userId: member.userId,
      status: 'active',
      joinedAt: new Date(),
      permissions: member.permissions ?? emptyPermissions(),
    })),
  );
}

async function seedFamilyFinances(
  wallets: GroupWalletService,
  settings: GroupSettingsService,
  transactions: GroupTransactionsService,
  group: GroupFixture,
  users: SeedUserMap,
  anchorDate: Date,
) {
  group.accountId = String(
    (
      await wallets.create(group.id, group.ownerId, {
        amount: 120000,
        openedAt: getSeedDate(-2, 1, anchorDate),
      })
    )._id,
  );
  for (const [name, color] of [
    ['Продукты', '#FF6B6B'],
    ['Дом', '#4ECDC4'],
    ['Досуг', '#45B7D1'],
  ] as const) {
    const category = await settings.saveCategory(group.id, group.ownerId, {
      name,
      color,
    });
    group.categories[name] = String(category!._id);
  }
  const month = getSeedMonthRange(0, anchorDate);
  await settings.saveLimit(group.id, group.ownerId, {
    categoryId: group.categories['Продукты'],
    total: 50000,
    startDate: month.startDate,
    endDate: month.endDate,
  });
  await transactions.create(group.id, group.ownerId, 'income', {
    accountId: group.accountId,
    amount: 180000,
    transactionDate: getSeedDate(0, 2, anchorDate),
    description: 'Пополнение семейного бюджета',
  });
  await transactions.create(group.id, users.alex, 'expense', {
    accountId: group.accountId,
    categoryId: group.categories['Продукты'],
    participantId: users.maria,
    amount: 8450.5,
    transactionDate: getSeedDate(0, 5, anchorDate),
    description: 'Покупки за Марию',
    merchant: 'Супермаркет',
  });
  await transactions.create(group.id, users.maria, 'expense', {
    accountId: group.accountId,
    categoryId: group.categories['Дом'],
    amount: 15600,
    transactionDate: getSeedDate(0, 10, anchorDate),
    description: 'Коммунальные услуги',
  });
  await transactions.create(group.id, users.elena, 'expense', {
    accountId: group.accountId,
    categoryId: group.categories['Досуг'],
    amount: 3200,
    transactionDate: getSeedDate(0, 15, anchorDate),
    description: 'Исторический расход бывшего участника',
  });
}

async function seedOrganizationFinances(
  wallets: GroupWalletService,
  settings: GroupSettingsService,
  transactions: GroupTransactionsService,
  group: GroupFixture,
  actorId: string,
  anchorDate: Date,
  categoryName: string,
  income: number,
  expense: number,
) {
  group.accountId = String(
    (
      await wallets.create(group.id, group.ownerId, {
        amount: 0,
        openedAt: getSeedDate(-1, 1, anchorDate),
      })
    )._id,
  );
  const category = await settings.saveCategory(group.id, group.ownerId, {
    name: categoryName,
    color: '#7B61FF',
  });
  group.categories[categoryName] = String(category!._id);
  await transactions.create(group.id, group.ownerId, 'income', {
    accountId: group.accountId,
    amount: income,
    transactionDate: getSeedDate(0, 1, anchorDate),
    description: 'Операционный бюджет',
  });
  await transactions.create(group.id, actorId, 'expense', {
    accountId: group.accountId,
    categoryId: group.categories[categoryName],
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
