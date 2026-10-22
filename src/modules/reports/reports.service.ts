import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { addMonths, endOfMonth, startOfMonth } from 'date-fns';
import { format } from 'date-fns/format';
import { Model, Types } from 'mongoose';
import {
  BudgetContext,
  budgetFilter,
} from '../../common/budget/budget-context';
import { normalizeMoney } from '../../common/money/money';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import { Account } from '../accounts/schemas/accounts.schema';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import { activeTransactionFilter } from '../transactions/transactions/active-transaction.filter';
import {
  CurrencyPeriodReport,
  PeriodReport,
} from './interfaces/period-report.interface';
export type ReportPeriod = {
  period: string;
  endDate: Date;
};
type AccountMeta = {
  _id: Types.ObjectId;
  type: 'balance' | 'saving';
  currency: string;
};
type Totals = Pick<
  CurrencyPeriodReport,
  'incomes' | 'expenses' | 'transfersIn' | 'transfersOut'
> & {
  expensesByCategory: Map<string, number>;
};
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactions: Model<TransactionDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    @InjectModel(Account.name)
    private readonly accounts: Model<Account>,
  ) {}
  async reportForBudget(
    budget: BudgetContext,
    periods: ReportPeriod[],
    grouping: 'month' | 'year',
    categoryIds: string[],
    filterCategories: boolean,
  ): Promise<PeriodReport[]> {
    const accounts = await this.accounts
      .find(budgetFilter(budget))
      .lean()
      .exec();
    return this.buildForBudget(
      budget,
      accounts.map((account) => ({ ...account, currency: account.currency! })),
      periods,
      grouping,
      categoryIds,
      filterCategories ? categoryIds : undefined,
      (account, endDate) =>
        this.snapshotsService.balanceForBudget(
          accounts.find((item) => item._id.equals(account._id))!,
          endDate,
        ),
    );
  }
  private async buildForBudget(
    budget: BudgetContext,
    accounts: AccountMeta[],
    periods: ReportPeriod[],
    grouping: 'month' | 'year',
    categoryIds: string[],
    filterIds: string[] | undefined,
    balanceAt: (account: AccountMeta, endDate: Date) => Promise<number>,
  ): Promise<PeriodReport[]> {
    const range = {
      from: new Date(
        periods[0].period + (grouping === 'year' ? '-01-01' : '-01'),
      ),
      to: periods.at(-1)!.endDate,
    };
    const [financial, movements] = await Promise.all([
      this.aggregateFinancial(budget, grouping, range, filterIds),
      this.aggregateTransfers(budget, grouping, range),
    ]);
    const totals = this.toTotals(financial, movements);
    return Promise.all(
      periods.map(async ({ period, endDate }) => {
        const currencies = new Set(accounts.map((account) => account.currency));
        for (const key of totals.keys())
          if (key.startsWith(`${period}:`))
            currencies.add(key.slice(period.length + 1));
        return {
          period,
          currencies: await Promise.all(
            [...currencies].sort().map(async (currency) => {
              const total = totals.get(`${period}:${currency}`) ?? this.empty();
              let balance = 0;
              let saving = 0;
              for (const account of accounts.filter(
                (item) => item.currency === currency,
              )) {
                const amount = await balanceAt(account, endDate);
                if (account.type === 'balance') balance += amount;
                else if (account.type === 'saving') saving += amount;
              }
              return {
                currency,
                incomes: normalizeMoney(total.incomes, currency),
                expenses: normalizeMoney(total.expenses, currency),
                transfersIn: normalizeMoney(total.transfersIn, currency),
                transfersOut: normalizeMoney(total.transfersOut, currency),
                balance: normalizeMoney(balance, currency),
                saving: normalizeMoney(saving, currency),
                expensesByCategory: categoryIds.map((categoryId) => ({
                  categoryId,
                  total: normalizeMoney(
                    total.expensesByCategory.get(categoryId) ?? 0,
                    currency,
                  ),
                })),
              };
            }),
          ),
        };
      }),
    );
  }
  private aggregateFinancial(
    budget: BudgetContext,
    grouping: 'month' | 'year',
    range: {
      from: Date;
      to: Date;
    },
    categoryIds?: string[],
  ) {
    const match: Record<string, unknown> = {
      ...budgetFilter(budget),
      ...activeTransactionFilter,
      type: { $in: ['income', 'expense'] },
      transactionDate: { $gte: range.from, $lte: range.to },
    };
    if (categoryIds)
      match.$or = [
        { type: 'income' },
        { category: { $in: categoryIds.map((id) => new Types.ObjectId(id)) } },
      ];
    return this.transactions.aggregate<{
      period: string;
      currency: string;
      type: string;
      categoryId?: string;
      total: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: {
            period: {
              $dateToString: {
                date: '$transactionDate',
                format: grouping === 'month' ? '%Y-%m' : '%Y',
              },
            },
            currency: '$currency',
            type: '$type',
            category: '$category',
          },
          total: { $sum: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          period: '$_id.period',
          currency: '$_id.currency',
          type: '$_id.type',
          categoryId: { $toString: '$_id.category' },
          total: 1,
        },
      },
    ]);
  }
  private aggregateTransfers(
    budget: BudgetContext,
    grouping: 'month' | 'year',
    range: {
      from: Date;
      to: Date;
    },
  ) {
    return this.transactions.aggregate<{
      period: string;
      currency: string;
      direction: 'in' | 'out';
      total: number;
    }>([
      {
        $match: {
          ...budgetFilter(budget),
          ...activeTransactionFilter,
          type: 'transfer',
          transactionDate: { $gte: range.from, $lte: range.to },
        },
      },
      {
        $project: {
          period: {
            $dateToString: {
              date: '$transactionDate',
              format: grouping === 'month' ? '%Y-%m' : '%Y',
            },
          },
          movements: [
            {
              currency: '$source.currency',
              direction: 'out',
              amount: '$source.amount',
            },
            {
              currency: '$destination.currency',
              direction: 'in',
              amount: '$destination.amount',
            },
          ],
        },
      },
      { $unwind: '$movements' },
      {
        $group: {
          _id: {
            period: '$period',
            currency: '$movements.currency',
            direction: '$movements.direction',
          },
          total: { $sum: '$movements.amount' },
        },
      },
      {
        $project: {
          _id: 0,
          period: '$_id.period',
          currency: '$_id.currency',
          direction: '$_id.direction',
          total: 1,
        },
      },
    ]);
  }
  private toTotals(
    financial: {
      period: string;
      currency: string;
      type: string;
      categoryId?: string;
      total: number;
    }[],
    transfers: {
      period: string;
      currency: string;
      direction: 'in' | 'out';
      total: number;
    }[],
  ) {
    const result = new Map<string, Totals>();
    for (const row of financial) {
      const key = `${row.period}:${row.currency}`;
      const item = result.get(key) ?? this.empty();
      if (row.type === 'income') item.incomes += row.total;
      else {
        item.expenses += row.total;
        if (row.categoryId)
          item.expensesByCategory.set(row.categoryId, row.total);
      }
      result.set(key, item);
    }
    for (const row of transfers) {
      const key = `${row.period}:${row.currency}`;
      const item = result.get(key) ?? this.empty();
      if (row.direction === 'in') item.transfersIn += row.total;
      else item.transfersOut += row.total;
      result.set(key, item);
    }
    return result;
  }
  private empty(): Totals {
    return {
      incomes: 0,
      expenses: 0,
      transfersIn: 0,
      transfersOut: 0,
      expensesByCategory: new Map(),
    };
  }
  private monthPeriods(start: Date, end: Date) {
    const result: ReportPeriod[] = [];
    for (
      let cursor = startOfMonth(start);
      cursor <= startOfMonth(end);
      cursor = addMonths(cursor, 1)
    )
      result.push({
        period: format(cursor, 'yyyy-LL'),
        endDate: endOfMonth(cursor),
      });
    return result;
  }
}
