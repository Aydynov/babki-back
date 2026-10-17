export type IntegrityRelation = {
  id: string;
  sourceModel: string;
  sourceField: string;
  targetModel: string;
  sourceFilter?: Record<string, unknown>;
  targetFilter?: Record<string, unknown>;
  required?: boolean;
  sameBudget?: boolean;
  planOrigin?: boolean;
  expenseOrigin?: boolean;
};

export const integrityRelations: IntegrityRelation[] = [
  {
    id: 'transaction.account',
    sourceModel: 'Transaction',
    sourceField: 'accountId',
    targetModel: 'Account',
  },
  {
    id: 'transfer.sourceAccount',
    sourceModel: 'Transaction',
    sourceField: 'source.accountId',
    targetModel: 'Account',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transfer.destinationAccount',
    sourceModel: 'Transaction',
    sourceField: 'destination.accountId',
    targetModel: 'Account',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transfer.sourceSnapshot',
    sourceModel: 'Transaction',
    sourceField: 'source.snapshotId',
    targetModel: 'AccountSnapshot',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transfer.destinationSnapshot',
    sourceModel: 'Transaction',
    sourceField: 'destination.snapshotId',
    targetModel: 'AccountSnapshot',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'user.defaultAccount',
    sourceModel: 'User',
    sourceField: 'defaultAccountId',
    targetModel: 'Account',
  },
  {
    id: 'transaction.snapshot',
    sourceModel: 'Transaction',
    sourceField: 'snapshotId',
    targetModel: 'AccountSnapshot',
  },
  {
    id: 'expense.category',
    sourceModel: 'Transaction',
    sourceField: 'category',
    targetModel: 'ExpenseCategory',
    sourceFilter: { type: 'expense' },
  },
  {
    id: 'limit.category',
    sourceModel: 'ExpenseLimit',
    sourceField: 'category',
    targetModel: 'ExpenseCategory',
  },
  {
    id: 'plan.category',
    sourceModel: 'Plan',
    sourceField: 'categoryId',
    targetModel: 'ExpenseCategory',
  },
  {
    id: 'plan.expense',
    sourceModel: 'Plan',
    sourceField: 'expenseId',
    targetModel: 'Transaction',
    targetFilter: { type: 'expense' },
  },
  {
    id: 'debtTransaction.debt',
    sourceModel: 'DebtTransaction',
    sourceField: 'debtId',
    targetModel: 'Debt',
  },
  {
    id: 'snapshot.account',
    sourceModel: 'AccountSnapshot',
    sourceField: 'accountId',
    targetModel: 'Account',
  },
  ...userRelations(),
  ...groupRelations(),
  ...ownerRelations(),
  {
    id: 'expense.plan.origin',
    sourceModel: 'Transaction',
    sourceField: 'origin.id',
    sourceFilter: { type: 'expense', 'origin.type': 'plan' },
    targetModel: 'Plan',
    sameBudget: true,
    expenseOrigin: true,
    required: true,
  },
  {
    id: 'expense.plan.category.budget',
    sourceModel: 'Transaction',
    sourceField: 'category',
    sourceFilter: { type: 'expense', 'origin.type': 'plan' },
    targetModel: 'ExpenseCategory',
    sameBudget: true,
    required: true,
  },
  {
    id: 'plan.createdBy',
    sourceModel: 'Plan',
    sourceField: 'createdBy',
    targetModel: 'User',
    required: true,
  },
  {
    id: 'plan.category.budget',
    sourceModel: 'Plan',
    sourceField: 'categoryId',
    targetModel: 'ExpenseCategory',
    sameBudget: true,
    required: true,
  },
  {
    id: 'plan.expense.budget',
    sourceModel: 'Plan',
    sourceField: 'expenseId',
    targetModel: 'Transaction',
    targetFilter: { type: 'expense' },
    sameBudget: true,
  },
  {
    id: 'plan.expense.origin',
    sourceModel: 'Plan',
    sourceField: 'expenseId',
    targetModel: 'Transaction',
    targetFilter: { type: 'expense' },
    sameBudget: true,
    planOrigin: true,
    sourceFilter: { status: 'closed' },
    required: true,
  },
];

function userRelations(): IntegrityRelation[] {
  return [
    ['account.user', 'Account', 'userId'],
    ['plan.user', 'Plan', 'userId'],
    ['debt.user', 'Debt', 'userId'],
    ['debtTransaction.user', 'DebtTransaction', 'userId'],
    ['category.user', 'ExpenseCategory', 'userId'],
    ['limit.user', 'ExpenseLimit', 'userId'],
    ['transaction.user', 'Transaction', 'userId'],
  ].map(([id, sourceModel, sourceField]) => ({
    id,
    sourceModel,
    sourceField,
    targetModel: 'User',
  }));
}

function groupRelations(): IntegrityRelation[] {
  return [
    relation('group.owner', 'Group', 'ownerId', 'User'),
    relation('membership.group', 'GroupMembership', 'groupId', 'Group'),
    relation('membership.user', 'GroupMembership', 'userId', 'User'),
    relation('invitation.group', 'GroupInvitation', 'groupId', 'Group'),
    relation('invitation.createdBy', 'GroupInvitation', 'createdBy', 'User'),
    relation('invitation.acceptedBy', 'GroupInvitation', 'acceptedBy', 'User'),
    relation('invitation.revokedBy', 'GroupInvitation', 'revokedBy', 'User'),
  ];
}

function ownerRelations(): IntegrityRelation[] {
  return [
    'Account',
    'ExpenseCategory',
    'ExpenseLimit',
    'Transaction',
    'Plan',
  ].flatMap((sourceModel) => {
    const prefix =
      sourceModel === 'ExpenseCategory'
        ? 'category'
        : sourceModel === 'ExpenseLimit'
          ? 'limit'
          : sourceModel.toLowerCase();
    return [
      {
        id: `${prefix}.owner.user`,
        sourceModel,
        sourceField: 'ownerId',
        targetModel: 'User',
        sourceFilter: { ownerType: 'user' },
        ...(sourceModel === 'Plan' ? { required: true } : {}),
      },
      {
        id: `${prefix}.owner.group`,
        sourceModel,
        sourceField: 'ownerId',
        targetModel: 'Group',
        sourceFilter: { ownerType: 'group' },
        ...(sourceModel === 'Plan' ? { required: true } : {}),
      },
    ];
  });
}

function relation(
  id: string,
  sourceModel: string,
  sourceField: string,
  targetModel: string,
): IntegrityRelation {
  return { id, sourceModel, sourceField, targetModel };
}
