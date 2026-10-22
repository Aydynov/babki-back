import { Types } from 'mongoose';
export type BudgetContext = {
  spaceId: Types.ObjectId;
};
export const spaceBudget = (id: string): BudgetContext => ({
  spaceId: new Types.ObjectId(id),
});
export function budgetFilter(budget: BudgetContext) {
  return { spaceId: budget.spaceId };
}
