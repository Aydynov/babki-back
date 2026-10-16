import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { personalBudget } from 'src/common/utils/personal-budget.util';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { ExpenseCategoryDocument } from '../../expense-categories/schemas/expense-category.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { ExpenseDocument } from '../schemas/expense.schema';
import { ExpensesService } from './expenses.service';

describe('ExpensesService shared budget operations', () => {
  const userId = '507f1f77bcf86cd799439011';
  const budget = personalBudget(userId);
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
    runForBudget: jest.fn(),
    accountForCreate: jest.fn(),
    lockAccountsForBudget: jest.fn(),
    ensureUserExists: jest.fn(),
    findAllForBudget: jest.fn(),
    findOneForBudget: jest.fn(),
    updateForBudget: jest.fn(),
    buildFilter: jest.fn(),
  };
  const service = new ExpensesService(
    model as unknown as Model<ExpenseDocument>,
    category as unknown as Model<ExpenseCategoryDocument>,
    snapshots as unknown as AccountsSnapshotsService,
    transactions as unknown as TransactionsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transactions.runForBudget.mockImplementation(
      (
        _budget,
        _actor,
        work: (s: ClientSession) => Promise<unknown>,
        supplied?: ClientSession,
      ) => work(supplied ?? session),
    );
    transactions.accountForCreate.mockResolvedValue(account);
    transactions.ensureUserExists.mockResolvedValue(budget);
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
    transactions.buildFilter.mockReturnValue({ ...budget, deletedAt: null });
  });

  it('passes a supplied session and origin through creation, category lock, and snapshot effect', async () => {
    const origin = { type: 'plan' as const, id: new Types.ObjectId() };
    const result = await service.create(userId, dto, session, origin);
    expect(transactions.runForBudget).toHaveBeenCalledWith(
      budget,
      userId,
      expect.any(Function),
      session,
    );
    expect(category.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'user', ownerId: budget.ownerId }),
      expect.any(Object),
      expect.objectContaining({ session }),
    );
    expect(model.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          origin,
          createdBy: budget.ownerId,
          participantId: budget.ownerId,
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
      service.create(userId, { ...dto, amount: 0.001 }, session),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects archived new category assignments', async () => {
    category.findOneAndUpdate.mockReturnValue({
      lean: () => ({
        exec: async () => ({ _id: categoryId, isArchived: true }),
      }),
    });
    await expect(service.create(userId, dto, session)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects missing snapshots before creating history', async () => {
    snapshots.prepareForBudget.mockResolvedValue(null);
    await expect(service.create(userId, dto, session)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  it('delegates populated personal pagination to the common reader', async () => {
    transactions.findAllForBudget.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await expect(
      service.findAll(userId, { page: 1, limit: 20 }),
    ).resolves.toMatchObject({ items: [], total: 0 });
    expect(transactions.findAllForBudget).toHaveBeenCalledWith(
      budget,
      { page: 1, limit: 20 },
      undefined,
      model,
      true,
    );
  });

  it('passes updates through the common writer in the active session', async () => {
    const row = {
      _id: new Types.ObjectId(),
      ...budget,
      accountId,
      amount: 100,
      currency: 'USD',
      type: 'expense',
      transactionDate: new Date(dto.transactionDate),
    };
    transactions.findOneForBudget.mockResolvedValue(row);
    transactions.updateForBudget.mockResolvedValue({ ...row, amount: 200 });
    await service.update(userId, row._id.toString(), { amount: 200 });
    expect(transactions.updateForBudget).toHaveBeenCalledWith(
      budget,
      row,
      { amount: 200 },
      session,
      model,
      true,
      undefined,
    );
  });

  it('includes deleted financial history only for dependency checks', async () => {
    model.countDocuments.mockResolvedValue(1);
    await service.countByFilters(userId, { categoryId: categoryId.toString() });
    await service.countHistoryByFilters(userId, {
      categoryId: categoryId.toString(),
    });
    expect(model.countDocuments).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deletedAt: null }),
    );
    expect(model.countDocuments.mock.calls[1][0]).not.toHaveProperty(
      'deletedAt',
    );
  });
});
