export type IntegrityRelation = {
  id: string;
  sourceModel: string;
  sourceField: string;
  targetModel: string;
  sourceFilter?: Record<string, unknown>;
  targetFilter?: Record<string, unknown>;
};

export const integrityRelations: IntegrityRelation[] = [
  {
    id: 'transaction.account',
    sourceModel: 'Transaction',
    sourceField: 'accountId',
    targetModel: 'Account',
  },
  {
    id: 'transaction.sourceAccount',
    sourceModel: 'Transaction',
    sourceField: 'sourceAccountId',
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
  return ['Account', 'ExpenseCategory', 'ExpenseLimit', 'Transaction'].flatMap(
    (sourceModel) => {
      const prefix = sourceModel === 'ExpenseCategory' ? 'category' :
        sourceModel === 'ExpenseLimit' ? 'limit' : sourceModel.toLowerCase();
      return [
        {
          id: `${prefix}.owner.user`,
          sourceModel,
          sourceField: 'ownerId',
          targetModel: 'User',
          sourceFilter: { ownerType: 'user' },
        },
        {
          id: `${prefix}.owner.group`,
          sourceModel,
          sourceField: 'ownerId',
          targetModel: 'Group',
          sourceFilter: { ownerType: 'group' },
        },
      ];
    },
  );
}

function relation(
  id: string,
  sourceModel: string,
  sourceField: string,
  targetModel: string,
): IntegrityRelation {
  return { id, sourceModel, sourceField, targetModel };
}
