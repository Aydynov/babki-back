import { AccountsSnapshotsSchema } from '../modules/accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsSchema } from '../modules/accounts/schemas/accounts.schema';
import { DebtTransactionSchema } from '../modules/debt-transactions/schemas/debt-transaction.schema';
import { DebtSchema } from '../modules/debts/schemas/debt.schema';
import { ExpenseCategorySchema } from '../modules/expense-categories/schemas/expense-category.schema';
import { ExpenseLimitSchema } from '../modules/expense-limits/schemas/expense-limit.schema';
import { GroupMembershipSchema } from '../modules/groups/schemas/group-membership.schema';
import { PlanSchema } from '../modules/plans/schemas/plan.schema';
import { TransactionSchema } from '../modules/transactions/schemas/transaction.schema';
import { TransferSchema } from '../modules/transactions/schemas/transfer.schema';
import { UserDeletionJobSchema } from '../modules/users/schemas/user-deletion-job.schema';

describe('query-aligned persistence indexes', () => {
  it('supports multiple personal accounts and owner/currency filtering', () => {
    expect(AccountsSchema.indexes()).toEqual([
      [{ ownerType: 1, ownerId: 1, archivedAt: 1 }, expect.any(Object)],
      [
        { ownerType: 1, ownerId: 1, archivedAt: 1, currency: 1, type: 1 },
        expect.any(Object),
      ],
    ]);
  });

  it('uses the unique account and date index for snapshot lookup in either direction', () => {
    expect(AccountsSnapshotsSchema.indexes()).toEqual([
      [{ accountId: 1, date: 1 }, expect.objectContaining({ unique: true })],
    ]);
  });

  it('supports debt transaction pagination and user cleanup independently', () => {
    expect(DebtTransactionSchema.indexes()).toEqual([
      [{ debtId: 1, transactionDate: -1, createdAt: -1 }, expect.any(Object)],
      [{ userId: 1 }, expect.any(Object)],
    ]);
  });

  it('supports debt pagination both with and without a status filter', () => {
    expect(DebtSchema.indexes()).toEqual([
      [{ userId: 1, archivedAt: 1, createdAt: -1 }, expect.any(Object)],
      [
        {
          userId: 1,
          archivedAt: 1,
          status: 1,
          currency: 1,
          createdAt: -1,
        },
        expect.any(Object),
      ],
    ]);
  });

  it('supports sorted active category lists without a legacy userId index', () => {
    expect(ExpenseCategorySchema.indexes()).toEqual([
      [
        { ownerType: 1, ownerId: 1, name: 1 },
        expect.objectContaining({ unique: true }),
      ],
      [
        { ownerType: 1, ownerId: 1, isArchived: 1, createdAt: -1 },
        expect.any(Object),
      ],
    ]);
  });

  it('supports sorted limit lists with and without a category filter', () => {
    expect(ExpenseLimitSchema.indexes()).toEqual([
      [
        {
          ownerType: 1,
          ownerId: 1,
          startDate: -1,
          endDate: -1,
          createdAt: -1,
        },
        expect.any(Object),
      ],
      [
        {
          ownerType: 1,
          ownerId: 1,
          category: 1,
          currency: 1,
          startDate: -1,
          endDate: -1,
          createdAt: -1,
        },
        expect.any(Object),
      ],
    ]);
  });

  it('supports stable member pagination inside an active group', () => {
    expect(GroupMembershipSchema.indexes()).toEqual([
      [{ groupId: 1, userId: 1 }, expect.objectContaining({ unique: true })],
      [{ userId: 1, status: 1, groupId: 1 }, expect.any(Object)],
      [{ groupId: 1, status: 1, joinedAt: 1, _id: 1 }, expect.any(Object)],
    ]);
  });

  it('supports plan pagination both with and without a status filter', () => {
    expect(PlanSchema.indexes()).toEqual([
      [
        {
          userId: 1,
          archivedAt: 1,
          targetDate: 1,
          createdAt: -1,
        },
        expect.any(Object),
      ],
      [
        {
          userId: 1,
          archivedAt: 1,
          status: 1,
          currency: 1,
          targetDate: 1,
          createdAt: -1,
        },
        expect.any(Object),
      ],
      [{ categoryId: 1 }, expect.any(Object)],
      [{ expenseId: 1 }, expect.any(Object)],
    ]);
  });

  it('supports active transaction lists and account balance calculations', () => {
    expect(TransactionSchema.indexes()).toEqual([
      [
        {
          userId: 1,
          snapshotId: 1,
          deletedAt: 1,
          transactionDate: -1,
          _id: -1,
        },
        expect.any(Object),
      ],
      [
        {
          ownerType: 1,
          ownerId: 1,
          deletedAt: 1,
          transactionDate: -1,
          _id: -1,
        },
        expect.any(Object),
      ],
      [
        {
          ownerType: 1,
          ownerId: 1,
          deletedAt: 1,
          type: 1,
          transactionDate: -1,
          _id: -1,
        },
        expect.any(Object),
      ],
      [
        {
          accountId: 1,
          deletedAt: 1,
          transactionDate: -1,
          _id: -1,
        },
        expect.any(Object),
      ],
      [
        {
          ownerType: 1,
          ownerId: 1,
          participantId: 1,
          deletedAt: 1,
          transactionDate: -1,
          _id: -1,
        },
        expect.any(Object),
      ],
      [
        {
          category: 1,
          deletedAt: 1,
          transactionDate: -1,
          _id: -1,
        },
        expect.any(Object),
      ],
      [{ 'origin.type': 1, 'origin.id': 1 }, expect.any(Object)],
    ]);
    expect(TransferSchema.indexes()).toEqual([
      [{ 'source.accountId': 1, transactionDate: -1 }, expect.any(Object)],
      [{ 'destination.accountId': 1, transactionDate: -1 }, expect.any(Object)],
    ]);
  });

  it('claims unfinished deletion jobs in requested order', () => {
    expect(UserDeletionJobSchema.indexes()).toEqual([
      [{ userId: 1 }, expect.objectContaining({ unique: true })],
      [
        { requestedAt: 1 },
        expect.objectContaining({
          partialFilterExpression: { completedAt: null },
        }),
      ],
    ]);
  });
});
