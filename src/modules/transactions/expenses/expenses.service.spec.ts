import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { spaceBudget } from 'src/common/budget/budget-context';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { ExpenseCategoryDocument } from '../../expense-categories/schemas/expense-category.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { ExpenseDocument } from '../schemas/expense.schema';
import { ExpensesService } from './expenses.service';
describe('ExpensesService shared budget operations', () => {
  const userId = '507f1f77bcf86cd799439011';
  const budget = spaceBudget('507f1f77bcf86cd799439099');
  const accountId = new Types.ObjectId('507f1f77bcf86cd799439012');
  const categoryId = new Types.ObjectId('507f1f77bcf86cd799439013');
  const snapshotId = new Types.ObjectId('507f1f77bcf86cd799439014');
  const account = { ...budget, _id: accountId, currency: 'USD' };
  const session = {} as ClientSession;
  const dto = {
    accountId: accountId.toString(),
    categoryId: categoryId.toString(),
    amount: 100,
    transactionDate: '2026-06-01',
    description: 'Test expense',
  };
  const model = { create: jest.fn(), countDocuments: jest.fn() };
  const category = { findOneAndUpdate: jest.fn() };
  const snapshots = { prepareForBudget: jest.fn(), applyForBudget: jest.fn() };
  const transactions = {
    validateMoneyForBudget:
      TransactionsService.prototype.validateMoneyForBudget,
    accountForCreate: jest.fn(),
    lockAccountsForBudget: jest.fn(),
  };
  const service = new ExpensesService(
    model as unknown as Model<ExpenseDocument>,
    category as unknown as Model<ExpenseCategoryDocument>,
    snapshots as unknown as AccountsSnapshotsService,
    transactions as unknown as TransactionsService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    transactions.accountForCreate.mockResolvedValue(account);
    category.findOneAndUpdate.mockReturnValue({
      lean: () => ({
        exec: async () => ({ _id: categoryId, isArchived: false }),
      }),
    });
    snapshots.prepareForBudget.mockResolvedValue({
      _id: snapshotId,
      accountId,
    });
    const row = {
      _id: new Types.ObjectId(),
      ...budget,
      category: { _id: categoryId },
      amount: 100,
    };
    model.create.mockResolvedValue([
      { populate: async () => ({ toObject: () => row }), toObject: () => row },
    ]);
  });
  it('passes a supplied session and origin through creation, category lock, and snapshot effect', async () => {
    const origin = { type: 'plan' as const, id: new Types.ObjectId() };
    const result = await service.createForBudget(
      budget,
      userId,
      dto,
      session,
      origin,
    );
    expect(category.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: budget.spaceId }),
      expect.any(Object),
      expect.objectContaining({ session }),
    );
    expect(model.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          origin,
          createdBy: new Types.ObjectId(userId),
          participantId: new Types.ObjectId(userId),
          currency: 'USD',
        }),
      ],
      { session },
    );
    expect(snapshots.applyForBudget).toHaveBeenCalledWith(
      account,
      new Date(dto.transactionDate),
      -100,
      session,
    );
    expect(result).not.toHaveProperty('ownerId');
  });
  it('rejects currency precision before creating history', async () => {
    await expect(
      service.createForBudget(
        budget,
        userId,
        { ...dto, amount: 0.001 },
        session,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });
  it('rejects archived new category assignments', async () => {
    category.findOneAndUpdate.mockReturnValue({
      lean: () => ({
        exec: async () => ({ _id: categoryId, isArchived: true }),
      }),
    });
    await expect(
      service.createForBudget(budget, userId, dto, session),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(model.create).not.toHaveBeenCalled();
  });
  it('rejects missing snapshots before creating history', async () => {
    snapshots.prepareForBudget.mockResolvedValue(null);
    await expect(
      service.createForBudget(budget, userId, dto, session),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.create).not.toHaveBeenCalled();
  });
});
