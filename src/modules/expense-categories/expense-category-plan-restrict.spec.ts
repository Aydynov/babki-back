import { ClientSession, Model, Types } from 'mongoose';
import { spaceBudget } from 'src/common/budget/budget-context';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { ExpenseLimit } from '../expense-limits/schemas/expense-limit.schema';
import { Plan } from '../plans/schemas/plan.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
describe('space category Plan RESTRICT', () => {
  it.each(['active', 'closed', 'archived'])(
    'blocks category deletion with an %s plan through the existing category lock',
    async () => {
      const categoryId = new Types.ObjectId();
      const budget = spaceBudget(new Types.ObjectId().toString());
      const session = {} as ClientSession;
      const category = { _id: categoryId, isArchived: false };
      const categories = {
        findOneAndUpdate: jest.fn(() => ({
          lean: () => ({ exec: async () => category }),
        })),
        deleteOne: jest.fn(),
      };
      const plans = {
        exists: jest.fn(() => ({
          session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
        })),
      };
      const unused = {
        exists: jest.fn(() => ({ session: jest.fn().mockResolvedValue(null) })),
      };
      const service = new ExpenseCategoriesService(
        categories as unknown as Model<ExpenseCategory>,
        unused as unknown as Model<ExpenseLimit>,
        plans as unknown as Model<Plan>,
        unused as unknown as Model<Transaction>,
      );
      await expect(
        service.removeForBudget(budget, categoryId.toString(), session),
      ).rejects.toThrow('Category is in use');
      expect(plans.exists).toHaveBeenCalledWith({
        spaceId: budget.spaceId,
        categoryId: { $in: [categoryId, categoryId.toString()] },
      });
      expect(categories.deleteOne).not.toHaveBeenCalled();
    },
  );
});
