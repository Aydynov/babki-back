import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import { AccountSnapshot } from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { ReportsService } from './reports.service';

describe('ReportsService multicurrency buckets', () => {
  const userId = new Types.ObjectId().toString();
  const rubId = new Types.ObjectId();
  const usdId = new Types.ObjectId();
  const categoryId = new Types.ObjectId().toString();
  const transactions = { aggregate: jest.fn() };
  const accounts = { findByParams: jest.fn() };
  const snapshotsService = { findByUserId: jest.fn() };
  const categories = { findAll: jest.fn() };
  const snapshotExec = jest.fn();
  const snapshots = {
    find: jest.fn(() => ({
      sort: () => ({ lean: () => ({ exec: snapshotExec }) }),
    })),
  };
  let service: ReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Transaction.name), useValue: transactions },
        { provide: AccountsService, useValue: accounts },
        { provide: AccountsSnapshotsService, useValue: snapshotsService },
        { provide: ExpenseCategoriesService, useValue: categories },
        { provide: getModelToken(AccountSnapshot.name), useValue: snapshots },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
    accounts.findByParams.mockResolvedValue([
      { _id: rubId, type: 'balance', currency: 'RUB' },
      { _id: usdId, type: 'saving', currency: 'USD' },
    ]);
    snapshotsService.findByUserId.mockResolvedValue([
      { date: new Date('2026-01-01') },
    ]);
    categories.findAll.mockResolvedValue([
      { _id: new Types.ObjectId(categoryId) },
    ]);
    snapshotExec.mockResolvedValue([
      { accountId: rubId, amount: 150000, date: new Date('2026-01-31') },
      { accountId: usdId, amount: 2000, date: new Date('2026-01-31') },
    ]);
  });

  it('keeps RUB and USD totals separate and does not recognize conversion as income', async () => {
    transactions.aggregate
      .mockResolvedValueOnce([
        { period: '2026-01', currency: 'RUB', type: 'income', total: 100000 },
        {
          period: '2026-01',
          currency: 'USD',
          type: 'expense',
          categoryId,
          total: 50,
        },
      ])
      .mockResolvedValueOnce([
        { period: '2026-01', currency: 'RUB', direction: 'out', total: 90000 },
        { period: '2026-01', currency: 'USD', direction: 'in', total: 1000 },
      ]);

    const result = await service.findMonthly(userId, {
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });

    expect(result).toEqual([
      {
        period: '2026-01',
        currencies: [
          {
            currency: 'RUB',
            incomes: 100000,
            expenses: 0,
            transfersIn: 0,
            transfersOut: 90000,
            balance: 150000,
            saving: 0,
            expensesByCategory: [{ categoryId, total: 0 }],
          },
          {
            currency: 'USD',
            incomes: 0,
            expenses: 50,
            transfersIn: 1000,
            transfersOut: 0,
            balance: 0,
            saving: 2000,
            expensesByCategory: [{ categoryId, total: 50 }],
          },
        ],
      },
    ]);
  });

  it('normalizes aggregated floating point totals to the currency precision', async () => {
    transactions.aggregate
      .mockResolvedValueOnce([
        {
          period: '2026-01',
          currency: 'USD',
          type: 'expense',
          categoryId,
          total: 0.30000000000000004,
        },
      ])
      .mockResolvedValueOnce([]);
    snapshotExec.mockResolvedValue([
      {
        accountId: usdId,
        amount: 0.30000000000000004,
        date: new Date('2026-01-31'),
      },
    ]);

    const report = await service.findMonthly(userId, {
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });

    expect(
      report[0].currencies.find(({ currency }) => currency === 'USD'),
    ).toMatchObject({
      expenses: 0.3,
      saving: 0.3,
      expensesByCategory: [{ categoryId, total: 0.3 }],
    });
  });
});
