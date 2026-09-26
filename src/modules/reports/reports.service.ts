import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  addMonths,
  endOfMonth,
  endOfYear,
  isAfter,
  startOfMonth,
  startOfYear,
} from 'date-fns';
import { format } from 'date-fns/format';
import { Model, Types } from 'mongoose';
import { normalizeMoney } from '../../common/money/money';
import { personalBudget } from '../../common/utils/personal-budget.util';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import {
  AccountSnapshot,
  AccountSnapshotsDocument,
} from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import { activeTransactionFilter } from '../transactions/transactions/active-transaction.filter';
import { MonthlyReportsQueryDto } from './dto/monthly-reports-query.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import {
  CurrencyPeriodReport,
  PeriodReport,
} from './interfaces/period-report.interface';

type Period = { period: string; endDate: Date };
type AccountMeta = {
  _id: Types.ObjectId;
  type: 'balance' | 'saving';
  currency: string;
};
type Totals = Pick<
  CurrencyPeriodReport,
  'incomes' | 'expenses' | 'transfersIn' | 'transfersOut'
> & { expensesByCategory: Map<string, number> };

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactions: Model<TransactionDocument>,
    private readonly accountsService: AccountsService,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly categoriesService: ExpenseCategoriesService,
    @InjectModel(AccountSnapshot.name)
    private readonly snapshots: Model<AccountSnapshotsDocument>,
  ) {}

  async findMonthly(
    userId: string,
    query: MonthlyReportsQueryDto,
  ): Promise<PeriodReport[]> {
    const accounts = await this.findAccounts(userId);
    const first = await this.firstSnapshot(userId);
    const reportStart = query.fromDate ?? first;
    if (!reportStart) return [];
    const start = startOfMonth(reportStart);
    const end = endOfMonth(query.toDate ?? new Date());
    if (isAfter(start, end)) return [];
    return this.build(
      userId,
      accounts,
      this.monthPeriods(start, end),
      'month',
      query.categories,
    );
  }

  async findYearly(
    userId: string,
    query: ReportsQueryDto,
  ): Promise<PeriodReport[]> {
    const accounts = await this.findAccounts(userId);
    const first = await this.firstSnapshot(userId);
    if (!first) return [];
    const periods: Period[] = [];
    for (
      let year = new Date(first).getFullYear();
      year <= new Date().getFullYear();
      year += 1
    )
      periods.push({
        period: String(year),
        endDate: endOfYear(new Date(year, 0, 1)),
      });
    return this.build(userId, accounts, periods, 'year', query.categories);
  }

  private async build(
    userId: string,
    accounts: AccountMeta[],
    periods: Period[],
    grouping: 'month' | 'year',
    filterIds?: string[],
  ) {
    const categories = await this.categoriesService.findAll(userId);
    const categoryIds = categories
      .map((item) => item._id.toString())
      .filter((id) => !filterIds?.length || filterIds.includes(id));
    const range = {
      from: new Date(
        periods[0].period + (grouping === 'year' ? '-01-01' : '-01'),
      ),
      to: periods.at(-1)!.endDate,
    };
    const [financial, movements, snapshots] = await Promise.all([
      this.aggregateFinancial(
        userId,
        grouping,
        range,
        filterIds && categoryIds,
      ),
      this.aggregateTransfers(userId, grouping, range),
      this.snapshots
        .find({
          accountId: { $in: accounts.map((account) => account._id) },
          date: { $lte: range.to },
        })
        .sort({ date: 1, createdAt: 1 })
        .lean()
        .exec(),
    ]);
    const totals = this.toTotals(financial, movements);
    return periods.map(({ period, endDate }) => {
      const currencies = new Set(accounts.map((account) => account.currency));
      for (const key of totals.keys())
        if (key.startsWith(`${period}:`))
          currencies.add(key.slice(period.length + 1));
      return {
        period,
        currencies: [...currencies].sort().map((currency) => {
          const total = totals.get(`${period}:${currency}`) ?? this.empty();
          let balance = 0;
          let saving = 0;
          for (const account of accounts.filter(
            (item) => item.currency === currency,
          )) {
            const latest = snapshots
              .filter(
                (item) =>
                  item.accountId.toString() === account._id.toString() &&
                  !isAfter(item.date, endDate),
              )
              .at(-1);
            if (account.type === 'balance') balance += latest?.amount ?? 0;
            else saving += latest?.amount ?? 0;
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
      };
    });
  }

  private aggregateFinancial(
    userId: string,
    grouping: 'month' | 'year',
    range: { from: Date; to: Date },
    categoryIds?: string[],
  ) {
    const match: Record<string, unknown> = {
      ...personalBudget(userId),
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
    userId: string,
    grouping: 'month' | 'year',
    range: { from: Date; to: Date },
  ) {
    return this.transactions.aggregate<{
      period: string;
      currency: string;
      direction: 'in' | 'out';
      total: number;
    }>([
      {
        $match: {
          ...personalBudget(userId),
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
  private async findAccounts(userId: string): Promise<AccountMeta[]> {
    const accounts = await this.accountsService.findByParams(userId, {});
    if (!accounts.length)
      throw new NotFoundException(`Accounts for user ${userId} not found.`);
    return accounts.map((account) => ({
      _id: account._id,
      type: account.type,
      currency: account.currency!,
    }));
  }
  private async firstSnapshot(userId: string) {
    const snapshots = await this.snapshotsService.findByUserId(userId);
    const first = snapshots[0]?.date ?? null;
    if (!first) return null;
    const yearStart = startOfYear(new Date());
    return isAfter(yearStart, first) ? yearStart : first;
  }
  private monthPeriods(start: Date, end: Date) {
    const result: Period[] = [];
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
