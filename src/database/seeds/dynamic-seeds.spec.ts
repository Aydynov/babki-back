import { INestApplicationContext } from '@nestjs/common';
import { SpaceDebtsService } from '../../modules/space-finances/space-debts.service';
import { SpacePlansService } from '../../modules/space-finances/space-plans.service';
import { SpaceSettingsService } from '../../modules/space-finances/space-settings.service';
import { SpaceTransactionsService } from '../../modules/space-finances/space-transactions.service';
import { SpaceTransfersService } from '../../modules/space-finances/space-transfers.service';
import { CategoryMap } from './03-categories';
import { seedCategories } from './03-categories';
import { seedLimits } from './04-limits';
import { seedTransactions } from './05-transactions';
import { seedDebts } from './06-debts';
import { seedPlans } from './07-plans';

const anchorDate = new Date('2030-03-08T18:30:00.000Z');
const userId = '507f1f77bcf86cd799439011';
const spaceId = '507f1f77bcf86cd799439099';
const balanceAccountId = '507f1f77bcf86cd799439012';
const savingAccountId = '507f1f77bcf86cd799439013';
const usdBalanceAccountId = '507f1f77bcf86cd799439014';
const usdSavingAccountId = '507f1f77bcf86cd799439015';
const categories: CategoryMap = {
  'Food & Dining': '507f1f77bcf86cd799439021',
  Transport: '507f1f77bcf86cd799439022',
  Entertainment: '507f1f77bcf86cd799439023',
  Utilities: '507f1f77bcf86cd799439024',
  Health: '507f1f77bcf86cd799439025',
  Shopping: '507f1f77bcf86cd799439026',
};

function createApp(providers: Map<unknown, unknown>) {
  return {
    get: jest.fn((token: unknown) => providers.get(token)),
  } as unknown as INestApplicationContext;
}

describe('dynamic seed dates', () => {
  it.each(Array.from({ length: 12 }, (_, month) => month))(
    'creates a deterministic 20-month window for anchor month %s',
    async (month) => {
      const transactions = {
        create: jest.fn().mockResolvedValue({ _id: 'income-id' }),
        change: jest.fn(),
      };
      const transfers = { create: jest.fn() };
      const app = createApp(
        new Map<unknown, unknown>([
          [SpaceTransactionsService, transactions],
          [SpaceTransfersService, transfers],
        ]),
      );
      const anchor = new Date(Date.UTC(2030, month, 8));
      await seedTransactions(
        app,
        userId,
        spaceId,
        balanceAccountId,
        savingAccountId,
        usdBalanceAccountId,
        usdSavingAccountId,
        categories,
        anchor,
      );
      const dates = [
        ...transactions.create.mock.calls.map(
          (call) => (call[3] as { transactionDate: string }).transactionDate,
        ),
        ...transfers.create.mock.calls.map(
          (call) => (call[2] as { transactionDate: string }).transactionDate,
        ),
      ].sort();
      expect(dates).toHaveLength(120);
      expect(
        dates.every((date) => Number.isFinite(new Date(date).getTime())),
      ).toBe(true);
      expect(dates[0]).toBe(
        new Date(Date.UTC(2030, month - 19, 1)).toISOString(),
      );
      expect(dates.at(-1)).toBe(
        new Date(Date.UTC(2030, month, 28)).toISOString(),
      );
      expect(transactions.change).toHaveBeenCalledWith(
        spaceId,
        userId,
        'income-id',
        'income',
      );
      expect(
        transactions.create.mock.calls.every(
          (call) => call[0] === spaceId && call[1] === userId,
        ),
      ).toBe(true);
    },
  );

  it('creates unused and archived category scenarios', async () => {
    const categoryService = {
      saveCategory: jest
        .fn()
        .mockImplementation(
          (_spaceId: string, _userId: string, dto: { name: string }) => ({
            _id: dto.name,
          }),
        ),
      update: jest.fn().mockResolvedValue({}),
    };
    const app = createApp(
      new Map<unknown, unknown>([[SpaceSettingsService, categoryService]]),
    );

    const result = await seedCategories(app, userId, spaceId);

    expect(Object.keys(result)).toHaveLength(8);
    expect(result['Deletion test: unused']).toBe('Deletion test: unused');
    expect(categoryService.saveCategory).toHaveBeenCalledWith(
      spaceId,
      userId,
      { isArchived: true },
      'Deletion test: archived',
    );
  });

  it('creates limits for the anchor month with meaningful remainders', async () => {
    const limits = { saveLimit: jest.fn().mockResolvedValue({}) };
    const app = createApp(
      new Map<unknown, unknown>([[SpaceSettingsService, limits]]),
    );

    await seedLimits(app, userId, spaceId, categories, anchorDate);

    expect(limits.saveLimit.mock.calls.map((call) => call[2])).toEqual([
      {
        currency: 'RUB',
        categoryId: categories['Food & Dining'],
        total: 65000,
        startDate: '2030-03-01T00:00:00.000Z',
        endDate: '2030-03-31T00:00:00.000Z',
      },
      {
        currency: 'RUB',
        categoryId: categories['Entertainment'],
        total: 25000,
        startDate: '2030-03-01T00:00:00.000Z',
        endDate: '2030-03-31T00:00:00.000Z',
      },
      {
        currency: 'USD',
        categoryId: categories['Entertainment'],
        total: 300,
        startDate: '2030-03-01T00:00:00.000Z',
        endDate: '2030-03-31T00:00:00.000Z',
      },
    ]);
  });

  it('keeps one current debt active and one recent debt closed', async () => {
    const debts = {
      create: jest
        .fn()
        .mockResolvedValueOnce({ _id: 'artur' })
        .mockResolvedValueOnce({ _id: 'maria' })
        .mockResolvedValueOnce({ _id: 'unused' }),
      repay: jest.fn().mockResolvedValue({}),
      archive: jest.fn().mockResolvedValue(undefined),
    };
    const app = createApp(
      new Map<unknown, unknown>([[SpaceDebtsService, debts]]),
    );

    await seedDebts(app, userId, spaceId, anchorDate);

    expect(debts.create.mock.calls[0][2]).toMatchObject({
      dueDate: '2030-05-01T00:00:00.000Z',
    });
    expect(debts.repay.mock.calls.map((call) => call[3])).toEqual([
      {
        repaymentDate: '2029-11-10T00:00:00.000Z',
        amount: 20000,
        description: 'First repayment',
        isIncome: false,
      },
      {
        repaymentDate: '2030-01-15T00:00:00.000Z',
        amount: 10000,
        description: 'Second repayment',
        isIncome: false,
      },
      {
        repaymentDate: '2030-03-05T00:00:00.000Z',
        amount: 5000,
        description: 'Current month repayment',
        isIncome: false,
      },
      {
        repaymentDate: '2029-12-20T00:00:00.000Z',
        amount: 100000,
        description: 'Full repayment',
        isIncome: false,
      },
    ]);
    expect(debts.create).toHaveBeenCalledTimes(4);
    expect(debts.archive).toHaveBeenCalledWith(spaceId, userId, 'maria');
  });

  it('preserves future, overdue, and closed plan scenarios', async () => {
    const plans = {
      create: jest.fn().mockResolvedValue({ _id: 'plan-id' }),
      close: jest.fn().mockResolvedValue({}),
      archive: jest.fn().mockResolvedValue(undefined),
    };
    const app = createApp(
      new Map<unknown, unknown>([[SpacePlansService, plans]]),
    );

    await seedPlans(app, userId, spaceId, 'account-id', categories, anchorDate);

    expect(
      plans.create.mock.calls.map(
        (call) => (call[2] as { targetDate: string }).targetDate,
      ),
    ).toEqual([
      '2030-06-01T00:00:00.000Z',
      '2030-05-01T00:00:00.000Z',
      '2030-04-20T00:00:00.000Z',
      '2030-02-01T00:00:00.000Z',
      '2030-07-01T00:00:00.000Z',
      '2030-01-20T00:00:00.000Z',
      '2029-12-15T00:00:00.000Z',
      '2029-11-10T00:00:00.000Z',
    ]);
    expect(plans.close.mock.calls.map((call) => call[3])).toEqual([
      { accountId: 'account-id', closingDate: '2030-01-15T00:00:00.000Z' },
      {
        accountId: 'account-id',
        closingDate: '2029-12-15T00:00:00.000Z',
        description: 'Bought new router and switched plan',
      },
      {
        accountId: 'account-id',
        closingDate: '2029-11-15T00:00:00.000Z',
        amount: 25000,
      },
    ]);
    expect(plans.archive).toHaveBeenCalledWith(spaceId, userId, 'plan-id');
  });
});
