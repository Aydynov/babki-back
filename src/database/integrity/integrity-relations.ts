export type IntegrityRelation = {
  id: string;
  sourceModel: string;
  sourceField: string;
  targetModel: string;
  sourceFilter?: Record<string, unknown>;
  targetFilter?: Record<string, unknown>;
  required?: boolean;
  sameBudget?: boolean;
  snapshotAccountField?: string;
  planOrigin?: boolean;
  expenseOrigin?: boolean;
  debtCheck?: 'balance' | 'repayment-income' | 'income-repayment';
};
export const integrityRelations: IntegrityRelation[] = [
  {
    id: 'transaction.account',
    sourceFilter: { type: { $in: ['income', 'expense'] } },
    required: true,
    sameBudget: true,
    sourceModel: 'Transaction',
    sourceField: 'accountId',
    targetModel: 'Account',
  },
  {
    id: 'transfer.sourceAccount',
    required: true,
    sameBudget: true,
    sourceModel: 'Transaction',
    sourceField: 'source.accountId',
    targetModel: 'Account',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transfer.destinationAccount',
    required: true,
    sameBudget: true,
    sourceModel: 'Transaction',
    sourceField: 'destination.accountId',
    targetModel: 'Account',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transfer.sourceSnapshot',
    required: true,
    snapshotAccountField: 'source.accountId',
    sourceModel: 'Transaction',
    sourceField: 'source.snapshotId',
    targetModel: 'AccountSnapshot',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transfer.destinationSnapshot',
    required: true,
    snapshotAccountField: 'destination.accountId',
    sourceModel: 'Transaction',
    sourceField: 'destination.snapshotId',
    targetModel: 'AccountSnapshot',
    sourceFilter: { type: 'transfer' },
  },
  {
    id: 'transaction.snapshot',
    sourceFilter: { type: { $in: ['income', 'expense'] } },
    required: true,
    snapshotAccountField: 'accountId',
    sourceModel: 'Transaction',
    sourceField: 'snapshotId',
    targetModel: 'AccountSnapshot',
  },
  {
    id: 'expense.category',
    required: true,
    sameBudget: true,
    sourceModel: 'Transaction',
    sourceField: 'category',
    targetModel: 'ExpenseCategory',
    sourceFilter: { type: 'expense' },
  },
  {
    id: 'limit.category',
    required: true,
    sameBudget: true,
    sourceModel: 'ExpenseLimit',
    sourceField: 'category',
    targetModel: 'ExpenseCategory',
  },
  {
    id: 'plan.category',
    required: true,
    sameBudget: true,
    sourceModel: 'Plan',
    sourceField: 'categoryId',
    targetModel: 'ExpenseCategory',
  },
  {
    id: 'plan.expense',
    sameBudget: true,
    sourceModel: 'Plan',
    sourceField: 'expenseId',
    targetModel: 'Transaction',
    targetFilter: { type: 'expense' },
  },
  {
    id: 'debtTransaction.debt',
    required: true,
    sameBudget: true,
    sourceModel: 'DebtTransaction',
    sourceField: 'debtId',
    targetModel: 'Debt',
  },
  {
    id: 'snapshot.account',
    required: true,
    sourceModel: 'AccountSnapshot',
    sourceField: 'accountId',
    targetModel: 'Account',
  },
  ...['Account', 'Transaction', 'ExpenseCategory', 'ExpenseLimit'].flatMap(
    (sourceModel) =>
      ['createdBy', 'deletedBy', 'participantId'].map((sourceField) =>
        relation(
          `${sourceModel}.${sourceField}`,
          sourceModel,
          sourceField,
          'User',
        ),
      ),
  ),
  ...spaceRelations(),
  ...spaceReferences(),
  ...debtRelations(),
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
function spaceRelations(): IntegrityRelation[] {
  return [
    relation('space.owner', 'Space', 'ownerId', 'User'),
    relation('membership.space', 'SpaceMembership', 'spaceId', 'Space'),
    relation('membership.user', 'SpaceMembership', 'userId', 'User'),
    relation('invitation.space', 'SpaceInvitation', 'spaceId', 'Space'),
    relation('invitation.createdBy', 'SpaceInvitation', 'createdBy', 'User'),
    relation('invitation.acceptedBy', 'SpaceInvitation', 'acceptedBy', 'User'),
    relation('invitation.revokedBy', 'SpaceInvitation', 'revokedBy', 'User'),
  ];
}
function spaceReferences(): IntegrityRelation[] {
  return [
    'Account',
    'ExpenseCategory',
    'ExpenseLimit',
    'Transaction',
    'Plan',
    'Debt',
    'DebtTransaction',
  ].map((sourceModel) => ({
    id: `${sourceModel}.space`,
    sourceModel,
    sourceField: 'spaceId',
    targetModel: 'Space',
    required: true,
  }));
}
function relation(
  id: string,
  sourceModel: string,
  sourceField: string,
  targetModel: string,
): IntegrityRelation {
  return { id, sourceModel, sourceField, targetModel };
}
function debtRelations(): IntegrityRelation[] {
  return [
    {
      id: 'debt.createdBy',
      sourceModel: 'Debt',
      sourceField: 'createdBy',
      targetModel: 'User',
      required: true,
    },
    {
      id: 'debtTransaction.createdBy',
      sourceModel: 'DebtTransaction',
      sourceField: 'createdBy',
      targetModel: 'User',
      required: true,
    },
    {
      id: 'debtTransaction.cancelledBy',
      sourceModel: 'DebtTransaction',
      sourceField: 'cancelledBy',
      targetModel: 'User',
      sourceFilter: { cancelledAt: { $ne: null } },
      required: true,
    },
    {
      id: 'debtTransaction.debt.budget',
      sourceModel: 'DebtTransaction',
      sourceField: 'debtId',
      targetModel: 'Debt',
      sameBudget: true,
      required: true,
    },
    {
      id: 'debt.space.balance',
      sourceModel: 'Debt',
      sourceField: 'remainingAmount',
      targetModel: 'DebtTransaction',
      debtCheck: 'balance',
    },
    {
      id: 'debtTransaction.income',
      sourceModel: 'DebtTransaction',
      sourceField: 'incomeId',
      targetModel: 'Transaction',
      debtCheck: 'repayment-income',
    },
    {
      id: 'income.debt.repayment',
      sourceModel: 'Transaction',
      sourceField: 'origin.id',
      targetModel: 'DebtTransaction',
      debtCheck: 'income-repayment',
    },
  ];
}
