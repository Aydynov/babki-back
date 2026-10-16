import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { personalBudget } from 'src/common/utils/personal-budget.util';
import { ExpenseCategory } from './schemas/expense-category.schema';

export async function lockBudgetExpenseCategory(
  model: Model<ExpenseCategory>,
  budget: BudgetContext,
  categoryId: string,
  session: ClientSession,
  options: { allowArchived?: boolean } = {},
) {
  const category = await model
    .findOneAndUpdate(
      { _id: new Types.ObjectId(categoryId), ...budgetFilter(budget) },
      { $inc: { mutationVersion: 1 } },
      { returnDocument: 'after', session },
    )
    .lean()
    .exec();
  if (!category) {
    throw new NotFoundException(
      budget.ownerType === 'user'
        ? `Expense category ${categoryId} for user ${budget.ownerId.toString()} not found.`
        : 'Category not found',
    );
  }
  if (category.isArchived && !options.allowArchived) {
    throw new ConflictException(
      budget.ownerType === 'user'
        ? 'Expense category is archived.'
        : 'Category is archived',
    );
  }
  return category;
}

export function lockPersonalExpenseCategory(
  model: Model<ExpenseCategory>,
  userId: string,
  categoryId: string,
  session: ClientSession,
  options: { allowArchived?: boolean } = {},
) {
  return lockBudgetExpenseCategory(
    model,
    personalBudget(userId),
    categoryId,
    session,
    options,
  );
}
