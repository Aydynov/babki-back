import { AccountsSchema } from 'src/modules/accounts/schemas/accounts.schema';
import { DebtSchema } from 'src/modules/debts/schemas/debt.schema';
import { DebtTransactionSchema } from 'src/modules/debt-transactions/schemas/debt-transaction.schema';
import { ExpenseCategorySchema } from 'src/modules/expense-categories/schemas/expense-category.schema';
import { ExpenseLimitSchema } from 'src/modules/expense-limits/schemas/expense-limit.schema';
import { SpaceInvitationSchema } from 'src/modules/spaces/schemas/space-invitation.schema';
import { SpaceMembershipSchema } from 'src/modules/spaces/schemas/space-membership.schema';
import { PlanSchema } from 'src/modules/plans/schemas/plan.schema';
import { TransactionSchema } from 'src/modules/transactions/schemas/transaction.schema';
import { TransferSchema } from 'src/modules/transactions/schemas/transfer.schema';
import { UserDeletionJobSchema } from 'src/modules/users/schemas/user-deletion-job.schema';
import { UserSchema } from 'src/modules/users/schemas/user.schema';
describe('lifecycle schema defaults', () => {
  it.each([
    ['account', AccountsSchema],
    ['plan', PlanSchema],
    ['debt', DebtSchema],
  ])('%s is active by default', (_name, schema) => {
    const path = (
      schema as unknown as {
        path(name: string): {
          options: {
            default: unknown;
          };
        };
      }
    ).path('archivedAt');
    expect(path.options.default).toBeNull();
  });
  it('serializes category dependency mutations', () => {
    expect(ExpenseCategorySchema.path('mutationVersion')?.options.default).toBe(
      0,
    );
  });
  it('stores a backward-compatible membership end reason', () => {
    const path = SpaceMembershipSchema.path('endReason');
    expect(path?.options.default).toBeNull();
    expect(path?.options.enum).toEqual([
      'member_left',
      'member_removed',
      'space_deleted',
      'user_deleted',
    ]);
  });
  it('stores a backward-compatible invitation revocation reason', () => {
    const path = SpaceInvitationSchema.path('revocationReason');
    expect(path?.options.default).toBeNull();
    expect(path?.options.enum).toEqual(['manual', 'space_deleted']);
  });
  it('stores immutable plan and debt transaction origins', () => {
    expect(TransactionSchema.path('origin')?.options.immutable).toBe(true);
    expect(TransactionSchema.path('origin.type')?.options.enum).toEqual([
      'plan',
      'debt',
    ]);
    expect(TransactionSchema.path('origin.id')).toBeDefined();
  });
  it('keeps existing users active by default', () => {
    expect(UserSchema.path('status')?.options).toMatchObject({
      default: 'active',
      enum: ['active', 'deletion_pending', 'deleted'],
      required: true,
    });
    expect(UserSchema.path('deletedAt')?.options.default).toBeNull();
  });
  it('defines a durable, uniquely user-scoped deletion job', () => {
    expect(UserDeletionJobSchema.path('stage')?.options).toMatchObject({
      default: 'memberships',
      enum: ['memberships', 'auth_data', 'tombstone', 'completed'],
    });
    expect(
      UserDeletionJobSchema.path('leaseOwner')?.options.default,
    ).toBeNull();
    expect(
      UserDeletionJobSchema.path('leaseExpiresAt')?.options.default,
    ).toBeNull();
    expect(UserDeletionJobSchema.path('attempts')?.options.default).toBe(0);
    expect(UserDeletionJobSchema.path('lastError')?.options).toMatchObject({
      default: null,
      maxlength: 200,
      select: false,
    });
    expect(UserDeletionJobSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ userId: 1 }, expect.objectContaining({ unique: true })],
        [
          { requestedAt: 1 },
          expect.objectContaining({
            partialFilterExpression: { completedAt: null },
          }),
        ],
      ]),
    );
  });
  it.each([
    [
      'transfer source account',
      TransferSchema,
      { 'source.accountId': 1, transactionDate: -1 },
    ],
    [
      'transfer destination account',
      TransferSchema,
      { 'destination.accountId': 1, transactionDate: -1 },
    ],
    [
      'expense category',
      TransactionSchema,
      { category: 1, deletedAt: 1, transactionDate: -1, _id: -1 },
    ],
    [
      'limit category',
      ExpenseLimitSchema,
      {
        spaceId: 1,
        category: 1,
        currency: 1,
        startDate: -1,
        endDate: -1,
        createdAt: -1,
      },
    ],
    ['plan category', PlanSchema, { categoryId: 1 }],
    ['plan expense', PlanSchema, { expenseId: 1 }],
    [
      'transaction origin',
      TransactionSchema,
      { 'origin.type': 1, 'origin.id': 1 },
    ],
    [
      'debt transaction',
      DebtTransactionSchema,
      { debtId: 1, transactionDate: -1, createdAt: -1 },
    ],
    ['account lifecycle', AccountsSchema, { spaceId: 1, archivedAt: 1 }],
    [
      'transaction lifecycle',
      TransactionSchema,
      {
        spaceId: 1,
        deletedAt: 1,
        transactionDate: -1,
        _id: -1,
      },
    ],
    [
      'category lifecycle',
      ExpenseCategorySchema,
      {
        spaceId: 1,
        isArchived: 1,
        createdAt: -1,
      },
    ],
    [
      'plan lifecycle',
      PlanSchema,
      { spaceId: 1, archivedAt: 1, targetDate: 1, createdAt: -1, _id: -1 },
    ],
    [
      'debt lifecycle',
      DebtSchema,
      { spaceId: 1, archivedAt: 1, createdAt: -1, _id: -1 },
    ],
    ['user lifecycle', UserSchema, { status: 1, deletedAt: 1 }],
    [
      'membership cleanup',
      SpaceMembershipSchema,
      { spaceId: 1, status: 1, joinedAt: 1, _id: 1 },
    ],
    ['invitation cleanup', SpaceInvitationSchema, { spaceId: 1, status: 1 }],
  ])('indexes %s lookups', (_name, schema, fields) => {
    expect(schema.indexes()).toEqual(
      expect.arrayContaining([[fields, expect.any(Object)]]),
    );
  });
});
