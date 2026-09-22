import { NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ClientSession, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { ExpenseCategory } from '../../expense-categories/schemas/expense-category.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpensesService } from './expenses.service';
import { Expense } from '../schemas/expense.schema';

describe('ExpensesService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const accountId = '507f1f77bcf86cd799439012';
  const categoryId = '507f1f77bcf86cd799439013';
  const snapshotId = '507f1f77bcf86cd799439014';

  const createExpenseDto: CreateExpenseDto = {
    categoryId,
    amount: 100,
    transactionDate: '2026-06-01',
    description: 'Test expense',
  };

  const mockConnection = { startSession: jest.fn() };
  const expenseModel = { create: jest.fn(), countDocuments: jest.fn() };
  const expenseCategoryModel = {
    exists: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const transactionsService = {
    ensureUserExists: jest.fn(),
    lockAccounts: jest.fn(),
    buildFilter: jest.fn(),
  };
  const snapshotsService = {
    findOrCreateByAccountId: jest.fn(),
    recalculateSnapshotsFromDate: jest.fn(),
  };

  let service: ExpensesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        {
          provide: getModelToken(ExpenseCategory.name),
          useValue: expenseCategoryModel,
        },
        { provide: TransactionsService, useValue: transactionsService },
        { provide: AccountsSnapshotsService, useValue: snapshotsService },
        { provide: getConnectionToken(), useValue: mockConnection },
      ],
    }).compile();

    service = moduleRef.get(ExpensesService);
    expenseCategoryModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          _id: new Types.ObjectId(categoryId),
          isArchived: false,
        }),
      }),
    });
    transactionsService.buildFilter.mockReturnValue({
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
      deletedAt: null,
    });
  });

  it('uses a provided session directly without creating a new one', async () => {
    const externalSession = {} as ClientSession;

    transactionsService.ensureUserExists.mockResolvedValue({
      userId: new Types.ObjectId(userId),
      accountId: new Types.ObjectId(accountId),
    });
    expenseCategoryModel.exists.mockReturnValue({
      session: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(categoryId) }),
    });
    snapshotsService.findOrCreateByAccountId.mockResolvedValue({
      _id: new Types.ObjectId(snapshotId),
      accountId: new Types.ObjectId(accountId),
    });
    snapshotsService.recalculateSnapshotsFromDate.mockResolvedValue(undefined);

    const mockPopulate = jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId() });
    expenseModel.create.mockResolvedValue([
      { _id: new Types.ObjectId(), populate: mockPopulate },
    ]);

    await service.create(userId, createExpenseDto, externalSession);

    expect(mockConnection.startSession).not.toHaveBeenCalled();
    expect(expenseModel.create).toHaveBeenCalledWith(expect.any(Array), {
      session: externalSession,
    });
  });

  it('persists an internal transaction origin', async () => {
    const externalSession = {} as ClientSession;
    const origin = {
      type: 'plan' as const,
      id: new Types.ObjectId('507f1f77bcf86cd799439015'),
    };

    transactionsService.ensureUserExists.mockResolvedValue({
      userId: new Types.ObjectId(userId),
      accountId: new Types.ObjectId(accountId),
    });
    expenseCategoryModel.exists.mockReturnValue({
      session: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(categoryId) }),
    });
    snapshotsService.findOrCreateByAccountId.mockResolvedValue({
      _id: new Types.ObjectId(snapshotId),
      accountId: new Types.ObjectId(accountId),
    });
    expenseModel.create.mockResolvedValue([
      {
        populate: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      },
    ]);

    await (
      service.create as unknown as (
        userId: string,
        dto: CreateExpenseDto,
        session: ClientSession,
        origin: typeof origin,
      ) => Promise<unknown>
    )(userId, createExpenseDto, externalSession, origin);

    expect(expenseModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ origin })],
      { session: externalSession },
    );
  });

  it('creates its own session when none is provided', async () => {
    const mockSession = {
      withTransaction: jest.fn().mockImplementation(async (fn) => fn()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    mockConnection.startSession.mockResolvedValue(mockSession);

    transactionsService.ensureUserExists.mockResolvedValue({
      userId: new Types.ObjectId(userId),
      accountId: new Types.ObjectId(accountId),
    });
    expenseCategoryModel.exists.mockReturnValue({
      session: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(categoryId) }),
    });
    snapshotsService.findOrCreateByAccountId.mockResolvedValue({
      _id: new Types.ObjectId(snapshotId),
      accountId: new Types.ObjectId(accountId),
    });
    snapshotsService.recalculateSnapshotsFromDate.mockResolvedValue(undefined);

    const mockPopulate = jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId() });
    expenseModel.create.mockResolvedValue([
      { _id: new Types.ObjectId(), populate: mockPopulate },
    ]);

    await service.create(userId, createExpenseDto);

    expect(mockConnection.startSession).toHaveBeenCalled();
    expect(mockSession.withTransaction).toHaveBeenCalled();
    expect(mockSession.endSession).toHaveBeenCalled();
  });

  it('throws NotFoundException when snapshot is not found', async () => {
    const externalSession = {} as ClientSession;

    transactionsService.ensureUserExists.mockResolvedValue({
      userId: new Types.ObjectId(userId),
      accountId: new Types.ObjectId(accountId),
    });
    expenseCategoryModel.exists.mockReturnValue({
      session: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(categoryId) }),
    });
    snapshotsService.findOrCreateByAccountId.mockResolvedValue(null);

    await expect(
      service.create(userId, createExpenseDto, externalSession),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(expenseModel.create).not.toHaveBeenCalled();
  });

  describe('update', () => {
    it('passes its internal session to both snapshot recalculation and findOneAndUpdate', async () => {
      const expenseId = '507f1f77bcf86cd799439015';
      const mockInternalSession = {
        withTransaction: jest.fn().mockImplementation(async (fn) => fn()),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
      mockConnection.startSession.mockResolvedValue(mockInternalSession);

      transactionsService.ensureUserExists.mockResolvedValue({
        userId: new Types.ObjectId(userId),
        accountId: new Types.ObjectId(accountId),
      });

      const existingExpense = {
        _id: new Types.ObjectId(expenseId),
        userId: new Types.ObjectId(userId),
        accountId: new Types.ObjectId(accountId),
        amount: 100,
        transactionDate: new Date('2026-06-01'),
      };

      // findOne chain (used internally by update)
      const findOneLean = jest.fn().mockResolvedValue(existingExpense);
      const findOnePopulate = jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue({ lean: findOneLean }),
      });
      expenseModel.findOne = jest
        .fn()
        .mockReturnValue({ populate: findOnePopulate });

      const updatedExpense = { ...existingExpense, amount: 200 };
      const updateLean = jest.fn().mockResolvedValue(updatedExpense);
      const updatePopulate = jest.fn().mockReturnValue({ lean: updateLean });
      expenseModel.findOneAndUpdate = jest
        .fn()
        .mockReturnValue({ populate: updatePopulate });

      snapshotsService.recalculateSnapshotsFromDate.mockResolvedValue(
        undefined,
      );

      await service.update(userId, expenseId, { amount: 200 });

      expect(
        snapshotsService.recalculateSnapshotsFromDate,
      ).toHaveBeenCalledWith(
        userId,
        existingExpense.accountId.toString(),
        expect.any(Object),
        { amount: -100 },
        mockInternalSession,
      );
      expect(expenseModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: null }),
        expect.any(Object),
        expect.objectContaining({ session: mockInternalSession }),
      );
    });
  });

  it('uses the active filter for normal counts but not dependency history', async () => {
    expenseModel.countDocuments.mockResolvedValue(1);

    await service.countByFilters(userId, { categoryId });
    await service.countHistoryByFilters(userId, { categoryId });

    expect(expenseModel.countDocuments).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deletedAt: null }),
    );
    expect(expenseModel.countDocuments.mock.calls[1][0]).not.toHaveProperty(
      'deletedAt',
    );
  });
});
