import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import { AccountSnapshot } from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { Account } from '../accounts/schemas/accounts.schema';
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
        { provide: getModelToken(Account.name), useValue: {} },
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

  describe('personal report history', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-15T12:00:00Z'));
      transactions.aggregate.mockResolvedValue([]);
      snapshotExec.mockResolvedValue([]);
    });

    afterEach(() => jest.useRealTimers());

    it.each([
      ['2026-01-31', '2025-06-30', '2024-11-30'],
      ['2024-11-30', '2026-01-31', '2025-06-30'],
      ['2025-06-30', '2024-11-30', '2026-01-31'],
    ])(
      'starts yearly history at the earliest snapshot (%s, %s, %s)',
      async (...dates: string[]) => {
        snapshotsService.findByUserId.mockResolvedValue(
          dates.map((date, index) => ({
            accountId: index === 0 ? rubId : usdId,
            date: new Date(date),
          })),
        );
        const result = await service.findYearly(userId, {});
        expect(result.map(({ period }) => period)).toEqual([
          '2024',
          '2025',
          '2026',
        ]);
        expect(result[1].currencies).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              currency: 'RUB',
              incomes: 0,
              expenses: 0,
            }),
          ]),
        );
        expect(transactions.aggregate).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              $match: expect.objectContaining({
                transactionDate: expect.objectContaining({
                  $gte: new Date('2024-01-01'),
                }),
              }),
            }),
          ]),
        );
      },
    );

    it.each([
      [{}, ['2025-11', '2025-12', '2026-01', '2026-02']],
      [{ toDate: '2025-12-31' }, ['2025-11', '2025-12']],
      [
        { fromDate: '2025-03-01', toDate: '2025-04-30' },
        ['2025-03', '2025-04'],
      ],
      [{ fromDate: '2025-04-01', toDate: '2025-03-31' }, []],
    ])('uses the correct monthly range for %j', async (query, expected) => {
      snapshotsService.findByUserId.mockResolvedValue([
        { accountId: rubId, date: new Date('2026-01-31') },
        { accountId: usdId, date: new Date('2025-11-30') },
      ]);
      expect(
        (await service.findMonthly(userId, query)).map(({ period }) => period),
      ).toEqual(expected);
    });

    it('returns no default history without snapshots but honors explicit monthly dates', async () => {
      snapshotsService.findByUserId.mockResolvedValue([]);
      expect(await service.findYearly(userId, {})).toEqual([]);
      expect(await service.findMonthly(userId, {})).toEqual([]);
      const result = await service.findMonthly(userId, {
        fromDate: '2025-03-01',
        toDate: '2025-03-31',
      });
      expect(result.map(({ period }) => period)).toEqual(['2025-03']);
      expect(result[0].currencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ balance: 0, saving: 0 }),
        ]),
      );
    });
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
