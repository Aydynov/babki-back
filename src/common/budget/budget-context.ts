import { Types } from 'mongoose';

export type BudgetContext = {
  ownerType: 'user' | 'group';
  ownerId: Types.ObjectId;
};

export const groupBudget = (id: string): BudgetContext => ({
  ownerType: 'group',
  ownerId: new Types.ObjectId(id),
});

export function budgetFilter(budget: BudgetContext) {
  const owner = { ownerType: budget.ownerType, ownerId: budget.ownerId };
  return budget.ownerType === 'user'
    ? { ...owner, userId: budget.ownerId }
    : owner;
}
