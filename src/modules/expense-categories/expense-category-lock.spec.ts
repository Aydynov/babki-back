import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { lockPersonalExpenseCategory } from './expense-category-lock';

describe('lockPersonalExpenseCategory', () => {
  const userId = '507f1f77bcf86cd799439011';
  const categoryId = '507f1f77bcf86cd799439012';
  const session = {} as ClientSession;
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const findOneAndUpdate = jest.fn(() => ({ lean }));
  const model = { findOneAndUpdate } as unknown as Model<ExpenseCategory>;

  beforeEach(() => jest.clearAllMocks());

  it('takes a mutation-version write lock in the caller transaction', async () => {
    exec.mockResolvedValue({
      _id: new Types.ObjectId(categoryId),
      isArchived: false,
    });

    await expect(
      lockPersonalExpenseCategory(model, userId, categoryId, session),
    ).resolves.toMatchObject({ isArchived: false });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: new Types.ObjectId(categoryId),
        ownerType: 'user',
        ownerId: new Types.ObjectId(userId),
      }),
      { $inc: { mutationVersion: 1 } },
      { returnDocument: 'after', session },
    );
  });

  it('rejects a new assignment to an archived category after locking it', async () => {
    exec.mockResolvedValue({
      _id: new Types.ObjectId(categoryId),
      isArchived: true,
    });

    await expect(
      lockPersonalExpenseCategory(model, userId, categoryId, session),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports a missing category without leaking another owner', async () => {
    exec.mockResolvedValue(null);

    await expect(
      lockPersonalExpenseCategory(model, userId, categoryId, session),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
