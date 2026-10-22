import { AccountsSnapshotsSchema } from '../modules/accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsSchema } from '../modules/accounts/schemas/accounts.schema';
import { DebtTransactionSchema } from '../modules/debt-transactions/schemas/debt-transaction.schema';
import { DebtSchema } from '../modules/debts/schemas/debt.schema';
import { ExpenseCategorySchema } from '../modules/expense-categories/schemas/expense-category.schema';
import { ExpenseLimitSchema } from '../modules/expense-limits/schemas/expense-limit.schema';
import { SpaceMembershipSchema } from '../modules/spaces/schemas/space-membership.schema';
import { PlanSchema } from '../modules/plans/schemas/plan.schema';
import { TransactionSchema } from '../modules/transactions/schemas/transaction.schema';
import { UserDeletionJobSchema } from '../modules/users/schemas/user-deletion-job.schema';

describe('query-aligned persistence indexes', () => {
  it.each([
    ['accounts', AccountsSchema],
    ['transactions', TransactionSchema],
    ['categories', ExpenseCategorySchema],
    ['limits', ExpenseLimitSchema],
    ['plans', PlanSchema],
    ['debts', DebtSchema],
    ['repayments', DebtTransactionSchema],
  ])(
    'indexes %s by space without legacy financial ownership',
    (_name, schema) => {
      const indexes = schema.indexes().map(([keys]) => keys);
      expect(indexes.some((keys) => keys.spaceId === 1)).toBe(true);
      expect(
        indexes.every(
          (keys) =>
            !('ownerType' in keys) &&
            !('ownerId' in keys) &&
            !('userId' in keys),
        ),
      ).toBe(true);
    },
  );

  it('keeps snapshot uniqueness on account/date without duplicating space', () => {
    expect(AccountsSnapshotsSchema.indexes()).toEqual([
      [{ accountId: 1, date: 1 }, expect.objectContaining({ unique: true })],
    ]);
    expect(AccountsSnapshotsSchema.path('spaceId')).toBeUndefined();
  });

  it('keeps membership and income history uniqueness', () => {
    expect(SpaceMembershipSchema.indexes()).toContainEqual([
      { spaceId: 1, userId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(DebtTransactionSchema.indexes()).toContainEqual([
      { incomeId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { incomeId: { $type: 'objectId' } },
      }),
    ]);
    expect(UserDeletionJobSchema.indexes()).toContainEqual([
      { userId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('keeps category names unique within a space', () => {
    expect(ExpenseCategorySchema.indexes()).toContainEqual([
      { spaceId: 1, name: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
