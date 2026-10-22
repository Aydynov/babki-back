import { ClientSession, Model, Types } from 'mongoose';
import { spaceBudget } from 'src/common/budget/budget-context';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { lockBudgetExpenseCategory } from './expense-category-lock';
describe('Budget expense category lock', () => {
  const budget = spaceBudget('507f1f77bcf86cd799439011');
  const categoryId = '507f1f77bcf86cd799439012';
  const session = {} as ClientSession;
  const exec = jest.fn();
  const findOneAndUpdate = jest.fn(() => ({ lean: () => ({ exec }) }));
  const model = { findOneAndUpdate } as unknown as Model<ExpenseCategory>;
  beforeEach(() => jest.clearAllMocks());
  it('locks the category using its space without a user ownership filter', async () => {
    exec.mockResolvedValue({
      _id: new Types.ObjectId(categoryId),
      isArchived: false,
    });
    await lockBudgetExpenseCategory(model, budget, categoryId, session);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(categoryId),
        spaceId: budget.spaceId,
      },
      { $inc: { mutationVersion: 1 } },
      { returnDocument: 'after', session },
    );
  });
  it('retains the space missing-category error', async () => {
    exec.mockResolvedValue(null);
    await expect(
      lockBudgetExpenseCategory(model, budget, categoryId, session),
    ).rejects.toThrow('Category not found');
  });
  it('rejects new archived assignments while allowing an existing historical reference', async () => {
    exec.mockResolvedValue({
      _id: new Types.ObjectId(categoryId),
      isArchived: true,
    });
    await expect(
      lockBudgetExpenseCategory(model, budget, categoryId, session),
    ).rejects.toThrow('Category is archived');
    await expect(
      lockBudgetExpenseCategory(model, budget, categoryId, session, {
        allowArchived: true,
      }),
    ).resolves.toMatchObject({ isArchived: true });
  });
});
