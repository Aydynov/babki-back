import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { Account } from '../accounts/schemas/accounts.schema';
import { ReportsService } from './reports.service';
describe('ReportsService multicurrency buckets', () => {
  const userId = new Types.ObjectId().toString();
  const rubId = new Types.ObjectId();
  const usdId = new Types.ObjectId();
  const categoryId = new Types.ObjectId().toString();
  const transactions = { aggregate: jest.fn() };
  const accountRows = [
    { _id: rubId, type: 'balance', currency: 'RUB' },
    { _id: usdId, type: 'saving', currency: 'USD' },
  ];
  const accounts = {
    find: jest.fn(() => ({ lean: () => ({ exec: async () => accountRows }) })),
  };
  const snapshotsService = { balanceForBudget: jest.fn() };
  let service: ReportsService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Account.name), useValue: accounts },
        { provide: getModelToken(Transaction.name), useValue: transactions },
        { provide: AccountsSnapshotsService, useValue: snapshotsService },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
    snapshotsService.balanceForBudget.mockImplementation(
      async (account: { _id: Types.ObjectId }) =>
        account._id.equals(rubId) ? 150000 : 2000,
    );
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
    const result = await service.reportForBudget(
      { spaceId: new Types.ObjectId(userId) },
      [{ period: '2026-01', endDate: new Date('2026-01-31T23:59:59.999Z') }],
      'month',
      [categoryId],
      false,
    );
    expect(accounts.find).toHaveBeenCalledWith({
      spaceId: new Types.ObjectId(userId),
    });
    for (const [pipeline] of transactions.aggregate.mock.calls) {
      expect(pipeline[0].$match).toMatchObject({
        spaceId: new Types.ObjectId(userId),
        deletedAt: null,
      });
      expect(pipeline[0].$match).not.toHaveProperty('userId');
    }
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
    snapshotsService.balanceForBudget.mockResolvedValue(0.1 + 0.2);
    const report = await service.reportForBudget(
      { spaceId: new Types.ObjectId(userId) },
      [{ period: '2026-01', endDate: new Date('2026-01-31T23:59:59.999Z') }],
      'month',
      [categoryId],
      false,
    );
    expect(
      report[0].currencies.find(({ currency }) => currency === 'USD'),
    ).toMatchObject({
      expenses: 0.3,
      saving: 0.3,
      expensesByCategory: [{ categoryId, total: 0.3 }],
    });
  });
});
