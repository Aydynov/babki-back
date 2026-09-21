import { personalBudget } from 'src/common/utils/personal-budget.util';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  startOfYear,
  addMonths,
  endOfMonth,
  endOfYear,
  isAfter,
  startOfMonth,
} from 'date-fns';
import { format } from 'date-fns/format';
import { Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import {
  AccountSnapshot,
  AccountSnapshotsDocument,
} from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { AccountType } from '../accounts/schemas/accounts.schema';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import { MonthlyReportsQueryDto } from './dto/monthly-reports-query.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { PeriodReport } from './interfaces/period-report.interface';

type AggregatedPeriodTotals = Omit<PeriodReport, 'balance' | 'saving'>;

type PeriodTotals = {
  expenses: number;
  incomes: number;
  saves: number;
  expensesByCategory: Map<string, number>;
};

type PeriodWithEndDate = {
  period: string;
  endDate: Date;
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly accountsService: AccountsService,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly expenseCategoriesService: ExpenseCategoriesService,
    @InjectModel(AccountSnapshot.name)
    private readonly snapshotsModel: Model<AccountSnapshotsDocument>,
  ) {}

  async findMonthly(
    userId: string,
    query: MonthlyReportsQueryDto,
  ): Promise<PeriodReport[]> {
    const accountIds = await this.findAccountIds(userId);
    const firstSnapshotInYear = await this.findFirstSnapshotDateInYear(userId);
    const reportStart = query.fromDate ?? firstSnapshotInYear;

    if (!reportStart) {
      return [];
    }

    const startDate = startOfMonth(reportStart);
    const endDate = endOfMonth(query.toDate ?? new Date());

    if (isAfter(startDate, endDate)) {
      return [];
    }

    const categoryIds = await this.resolveCategoryIds(userId, query.categories);
    const periods = this.buildMonthPeriods(startDate, endDate);
    const [totalsByPeriod, savingsByPeriod] = await Promise.all([
      this.aggregateTransactionTotals(
        userId,
        'month',
        { fromDate: startDate, toDate: endDate },
        query.categories && categoryIds,
      ),
      this.findSnapshotsAmountsByPeriod(accountIds, periods),
    ]);

    return this.mergePeriods(
      periods,
      totalsByPeriod,
      savingsByPeriod,
      categoryIds,
    );
  }

  async findYearly(
    userId: string,
    query: ReportsQueryDto,
  ): Promise<PeriodReport[]> {
    const accountIds = await this.findAccountIds(userId);
    const categoryIds = await this.resolveCategoryIds(userId, query.categories);
    const totalsByPeriod = await this.aggregateTransactionTotals(
      userId,
      'year',
      undefined,
      query.categories && categoryIds,
    );
    const periods = [...totalsByPeriod.keys()].sort().map((period) => ({
      period,
      endDate: endOfYear(new Date(Number(period), 0, 1)),
    }));

    const savingsByPeriod = await this.findSnapshotsAmountsByPeriod(
      accountIds,
      periods,
    );

    return this.mergePeriods(
      periods,
      totalsByPeriod,
      savingsByPeriod,
      categoryIds,
    );
  }

  private async resolveCategoryIds(userId: string, filterIds?: string[]) {
    const categories = await this.expenseCategoriesService.findAll(userId);
    const ids = categories.map((category) => category._id.toString());

    return filterIds?.length ? ids.filter((id) => filterIds.includes(id)) : ids;
  }

  private async findAccountIds(userId: string) {
    const accounts = await this.accountsService.findByParams(userId, {});

    if (!accounts.length) {
      throw new NotFoundException(`Accounts for user ${userId} not found.`);
    }

    return Object.fromEntries(
      accounts.map((account) => [account.type, account._id]),
    ) as Record<AccountType, Types.ObjectId>;
  }

  private async findFirstSnapshotDateInYear(userId: string) {
    const snapshots = await this.snapshotsService.findByUserId(userId);
    const firstSnapshotDate = snapshots[0]?.date ?? null;

    if (!firstSnapshotDate) {
      return null;
    }

    const startOfYearDate = startOfYear(new Date());

    if (isAfter(startOfYearDate, firstSnapshotDate)) {
      return startOfYearDate;
    }

    return firstSnapshotDate;
  }

  private async aggregateTransactionTotals(
    userId: string,
    periodType: 'month' | 'year',
    dateRange?: { fromDate: Date; toDate: Date },
    categoryIds?: string[],
  ) {
    const match: {
      userId: Types.ObjectId;
      ownerType: 'user';
      ownerId: Types.ObjectId;
      transactionDate?: { $gte: Date; $lte: Date };
      $or?: (
        { type: { $ne: string } } | { category: { $in: Types.ObjectId[] } }
      )[];
    } = { ...personalBudget(new Types.ObjectId(userId)) };

    if (dateRange) {
      match.transactionDate = {
        $gte: dateRange.fromDate,
        $lte: dateRange.toDate,
      };
    }

    if (categoryIds) {
      match.$or = [
        { type: { $ne: 'expense' } },
        { category: { $in: categoryIds.map((id) => new Types.ObjectId(id)) } },
      ];
    }

    const periodFormat = periodType === 'month' ? '%Y-%m' : '%Y';

    const totals =
      await this.transactionModel.aggregate<AggregatedPeriodTotals>([
        { $match: match },
        {
          $group: {
            _id: {
              period: {
                $dateToString: {
                  date: '$transactionDate',
                  format: periodFormat,
                },
              },
              type: '$type',
              category: '$category',
            },
            total: { $sum: '$amount' },
          },
        },
        {
          $group: {
            _id: '$_id.period',
            expenses: {
              $sum: {
                $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0],
              },
            },
            incomes: {
              $sum: {
                $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0],
              },
            },
            saves: {
              $sum: {
                $cond: [{ $eq: ['$_id.type', 'save'] }, '$total', 0],
              },
            },
            expensesByCategory: {
              $push: {
                $cond: [
                  { $eq: ['$_id.type', 'expense'] },
                  {
                    categoryId: { $toString: '$_id.category' },
                    total: '$total',
                  },
                  null,
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            period: '$_id',
            expenses: 1,
            incomes: 1,
            saves: 1,
            expensesByCategory: {
              $filter: {
                input: '$expensesByCategory',
                cond: { $ne: ['$$this', null] },
              },
            },
          },
        },
        { $sort: { period: 1 } },
      ]);

    return new Map<string, PeriodTotals>(
      totals.map((total) => [
        total.period,
        {
          expenses: total.expenses ?? 0,
          incomes: total.incomes ?? 0,
          saves: total.saves ?? 0,
          expensesByCategory: new Map(
            (total.expensesByCategory ?? []).map(({ categoryId, total }) => [
              categoryId,
              total,
            ]),
          ),
        },
      ]),
    );
  }

  private async findSnapshotsAmountsByPeriod(
    accountIds: Record<AccountType, Types.ObjectId>,
    periods: PeriodWithEndDate[],
  ) {
    const balancesByPeriod = new Map<
      string,
      Record<AccountType, number | null>
    >();

    if (!periods.length) {
      return balancesByPeriod;
    }

    const snapshots = await this.snapshotsModel
      .find({
        accountId: { $in: [accountIds.saving, accountIds.balance] },
        date: { $lte: periods[periods.length - 1].endDate },
      })
      .sort({ date: 1, createdAt: 1 })
      .lean()
      .exec();

    periods.forEach(({ endDate, period }) => {
      snapshots.forEach((snapshot) => {
        if (isAfter(snapshot.date, endDate)) {
          return;
        }

        const amounts = balancesByPeriod.get(period);
        const accountId = snapshot.accountId.toString();

        if (accountId === accountIds.balance.toString()) {
          balancesByPeriod.set(period, {
            saving: amounts?.saving ?? 0,
            balance: snapshot.amount,
          });
        } else if (accountId === accountIds.saving.toString()) {
          balancesByPeriod.set(period, {
            balance: amounts?.balance ?? 0,
            saving: snapshot.amount,
          });
        }
      });
    });

    return balancesByPeriod;
  }

  private buildMonthPeriods(startDate: Date, endDate: Date) {
    const periods: PeriodWithEndDate[] = [];
    let cursor = startOfMonth(startDate);
    const lastMonth = startOfMonth(endDate);

    while (cursor <= lastMonth) {
      periods.push({
        period: this.formatMonth(cursor),
        endDate: endOfMonth(cursor),
      });
      cursor = addMonths(cursor, 1);
    }

    return periods;
  }

  private mergePeriods(
    periods: PeriodWithEndDate[],
    totalsByPeriod: Map<string, PeriodTotals>,
    amountsByPeriod: Map<string, Record<AccountType, number | null>>,
    categoryIds: string[],
  ): PeriodReport[] {
    return periods.map((period) => {
      const totals = totalsByPeriod.get(period.period);

      return {
        period: period.period,
        expenses: totals?.expenses ?? 0,
        incomes: totals?.incomes ?? 0,
        saves: totals?.saves ?? 0,
        saving: amountsByPeriod.get(period.period)?.saving ?? 0,
        balance: amountsByPeriod.get(period.period)?.balance ?? 0,
        expensesByCategory: categoryIds.map((categoryId) => ({
          categoryId,
          total: totals?.expensesByCategory.get(categoryId) ?? 0,
        })),
      };
    });
  }

  private formatMonth(date: Date) {
    return format(date, 'yyyy-LL');
  }
}
