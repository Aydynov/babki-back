import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import { AccountSnapshot } from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const balanceAccountId = '507f1f77bcf86cd799439012';
  const savingAccountId = '507f1f77bcf86cd799439013';
  const foodCategoryId = '507f1f77bcf86cd799439021';
  const transportCategoryId = '507f1f77bcf86cd799439022';

  const accountsService = {
    findByParams: jest.fn(),
  };
  const snapshotsService = {
    findByUserId: jest.fn(),
  };
  const expenseCategoriesService = {
    findAll: jest.fn(),
  };
  const transactionModel = {
    aggregate: jest.fn(),
  };
  const snapshotsModel = {
    find: jest.fn(),
  };

  let service: ReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: getModelToken(Transaction.name),
          useValue: transactionModel,
        },
        { provide: AccountsService, useValue: accountsService },
        { provide: AccountsSnapshotsService, useValue: snapshotsService },
        {
          provide: ExpenseCategoriesService,
          useValue: expenseCategoriesService,
        },
        {
          provide: getModelToken(AccountSnapshot.name),
          useValue: snapshotsModel,
        },
      ],
    }).compile();

    service = moduleRef.get(ReportsService);
    mockAccounts();
    mockFirstSnapshot(new Date('2024-01-10T00:00:00.000Z'));
    mockSnapshots([]);
    mockCategories([foodCategoryId, transportCategoryId]);
    transactionModel.aggregate.mockResolvedValue([]);
  });

  it('maps mixed transaction totals into filled monthly periods', async () => {
    transactionModel.aggregate.mockResolvedValue([
      {
        period: '2024-01',
        incomes: 1000,
        expenses: 250,
        saves: 100,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 200 },
          { categoryId: transportCategoryId, total: 50 },
        ],
      },
      {
        period: '2024-03',
        incomes: 500,
        expenses: 75,
        saves: 25,
        expensesByCategory: [{ categoryId: foodCategoryId, total: 75 }],
      },
    ]);
    mockSnapshots([
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 650,
        date: new Date('2024-01-31T00:00:00.000Z'),
      },
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 1050,
        date: new Date('2024-03-15T00:00:00.000Z'),
      },
    ]);

    const result = await service.findMonthly(userId, {
      fromDate: '2024-01-15',
      toDate: '2024-03-02',
    });

    expect(result).toEqual([
      {
        period: '2024-01',
        expenses: 250,
        incomes: 1000,
        saves: 100,
        saving: 0,
        balance: 650,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 200 },
          { categoryId: transportCategoryId, total: 50 },
        ],
      },
      {
        period: '2024-02',
        expenses: 0,
        incomes: 0,
        saves: 0,
        saving: 0,
        balance: 650,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 0 },
          { categoryId: transportCategoryId, total: 0 },
        ],
      },
      {
        period: '2024-03',
        expenses: 75,
        incomes: 500,
        saves: 25,
        saving: 0,
        balance: 1050,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 75 },
          { categoryId: transportCategoryId, total: 0 },
        ],
      },
    ]);
  });

  it('returns an empty monthly report when there is no data and no fromDate', async () => {
    mockFirstSnapshot(null);

    const result = await service.findMonthly(userId, {});

    expect(result).toEqual([]);
    expect(transactionModel.aggregate).not.toHaveBeenCalled();
    expect(snapshotsModel.find).not.toHaveBeenCalled();
  });

  it('uses the latest balance snapshot at the end of each month', async () => {
    transactionModel.aggregate.mockResolvedValue([
      {
        period: '2024-01',
        incomes: 100,
        expenses: 0,
        saves: 0,
        expensesByCategory: [],
      },
    ]);
    mockSnapshots([
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 100,
        date: new Date('2023-12-01T00:00:00.000Z'),
      },
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 150,
        date: new Date('2024-01-10T00:00:00.000Z'),
      },
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 175,
        date: new Date('2024-01-31T00:00:00.000Z'),
      },
    ]);

    const result = await service.findMonthly(userId, {
      fromDate: '2024-01-01',
      toDate: '2024-01-31',
    });

    expect(result[0]).toEqual({
      period: '2024-01',
      expenses: 0,
      incomes: 100,
      saves: 0,
      saving: 0,
      balance: 175,
      expensesByCategory: [
        { categoryId: foodCategoryId, total: 0 },
        { categoryId: transportCategoryId, total: 0 },
      ],
    });
    expect(snapshotsModel.find).toHaveBeenCalledWith({
      accountId: {
        $in: [
          new Types.ObjectId(savingAccountId),
          new Types.ObjectId(balanceAccountId),
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      date: { $lte: expect.any(Date) },
    });
  });

  it('filters expense totals and breakdown by the requested categories', async () => {
    transactionModel.aggregate.mockResolvedValue([
      {
        period: '2024-01',
        incomes: 1000,
        expenses: 200,
        saves: 100,
        expensesByCategory: [{ categoryId: foodCategoryId, total: 200 }],
      },
    ]);
    const unknownCategoryId = '507f1f77bcf86cd799439099';

    const result = await service.findMonthly(userId, {
      fromDate: '2024-01-01',
      toDate: '2024-01-31',
      categories: [foodCategoryId, unknownCategoryId],
    });

    expect(transactionModel.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          $match: expect.objectContaining({
            deletedAt: null,
            $or: [
              { type: { $ne: 'expense' } },
              { category: { $in: [new Types.ObjectId(foodCategoryId)] } },
            ],
          }),
        },
      ]),
    );
    expect(result[0]).toEqual({
      period: '2024-01',
      expenses: 200,
      incomes: 1000,
      saves: 100,
      saving: 0,
      balance: 0,
      expensesByCategory: [{ categoryId: foodCategoryId, total: 200 }],
    });
  });

  it('does not restrict the aggregation when no category filter is given', async () => {
    await service.findMonthly(userId, {
      fromDate: '2024-01-01',
      toDate: '2024-01-31',
    });

    const [pipeline] = transactionModel.aggregate.mock.calls[0] as [
      { $match?: Record<string, unknown> }[],
    ];
    expect(pipeline[0].$match).not.toHaveProperty('$or');
  });

  it('returns yearly reports only for years with transactions', async () => {
    transactionModel.aggregate.mockResolvedValue([
      {
        period: '2023',
        incomes: 1000,
        expenses: 300,
        saves: 200,
        expensesByCategory: [{ categoryId: foodCategoryId, total: 300 }],
      },
      {
        period: '2025',
        incomes: 2000,
        expenses: 500,
        saves: 400,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 350 },
          { categoryId: transportCategoryId, total: 150 },
        ],
      },
    ]);
    mockSnapshots([
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 800,
        date: new Date('2023-12-31T00:00:00.000Z'),
      },
      {
        accountId: new Types.ObjectId(balanceAccountId),
        amount: 1900,
        date: new Date('2025-12-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.findYearly(userId, {});

    expect(result).toEqual([
      {
        period: '2023',
        expenses: 300,
        incomes: 1000,
        saves: 200,
        saving: 0,
        balance: 800,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 300 },
          { categoryId: transportCategoryId, total: 0 },
        ],
      },
      {
        period: '2025',
        expenses: 500,
        incomes: 2000,
        saves: 400,
        saving: 0,
        balance: 1900,
        expensesByCategory: [
          { categoryId: foodCategoryId, total: 350 },
          { categoryId: transportCategoryId, total: 150 },
        ],
      },
    ]);
  });

  function mockAccounts() {
    accountsService.findByParams.mockResolvedValue([
      { type: 'balance', _id: new Types.ObjectId(balanceAccountId) },
      { type: 'saving', _id: new Types.ObjectId(savingAccountId) },
    ]);
  }

  function mockFirstSnapshot(date: Date | null) {
    snapshotsService.findByUserId.mockResolvedValue(date ? [{ date }] : []);
  }

  function mockCategories(categoryIds: string[]) {
    expenseCategoriesService.findAll.mockResolvedValue(
      categoryIds.map((id) => ({
        _id: new Types.ObjectId(id),
        name: `category-${id}`,
      })),
    );
  }

  function mockSnapshots(
    snapshots: { accountId: Types.ObjectId; amount: number; date: Date }[],
  ) {
    const exec = jest.fn().mockResolvedValue(snapshots);
    const lean = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ lean });

    snapshotsModel.find.mockReturnValue({ sort });
  }
});
