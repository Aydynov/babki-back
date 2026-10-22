import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { ExpenseCategory } from './schemas/expense-category.schema';
export async function lockBudgetExpenseCategory(
  model: Model<ExpenseCategory>,
  budget: BudgetContext,
  categoryId: string,
  session: ClientSession,
  options: {
    allowArchived?: boolean;
  } = {},
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
    throw new NotFoundException('Category not found');
  }
  if (category.isArchived && !options.allowArchived) {
    throw new ConflictException('Category is archived');
  }
  return category;
}
