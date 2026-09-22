import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { personalBudget } from 'src/common/utils/personal-budget.util';
import { ExpenseCategory } from './schemas/expense-category.schema';

export async function lockPersonalExpenseCategory(
  model: Model<ExpenseCategory>,
  userId: string,
  categoryId: string,
  session: ClientSession,
  options: { allowArchived?: boolean } = {},
) {
  const category = await model
    .findOneAndUpdate(
      {
        _id: new Types.ObjectId(categoryId),
        ...personalBudget(new Types.ObjectId(userId)),
      },
      { $inc: { mutationVersion: 1 } },
      { returnDocument: 'after', session },
    )
    .lean()
    .exec();

  if (!category) {
    throw new NotFoundException(
      `Expense category ${categoryId} for user ${userId} not found.`,
    );
  }
  if (category.isArchived && !options.allowArchived) {
    throw new ConflictException('Expense category is archived.');
  }

  return category;
}
