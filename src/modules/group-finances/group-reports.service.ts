import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account } from '../accounts/schemas/accounts.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { BudgetAccessService, groupBudget } from './budget-access.service';
import { GroupWalletService, money } from './group-wallet.service';
import { GroupReportsQueryDto } from './dto/group-finances.dto';
import { PeriodReport } from '../reports/interfaces/period-report.interface';
@Injectable()
export class GroupReportsService {
  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
    @InjectModel(Transaction.name)
    private readonly transactions: Model<Transaction>,
    @InjectModel(ExpenseCategory.name)
    private readonly categories: Model<ExpenseCategory>,
    private readonly access: BudgetAccessService,
    private readonly wallet: GroupWalletService,
  ) {}
  async report(
    groupId: string,
    actor: string,
    query: GroupReportsQueryDto,
    yearly = false,
  ): Promise<PeriodReport[]> {
    const budget = await this.access.resolve(actor, groupId);
    const account = await this.accounts.findOne(budget);
    const now = new Date();
    const from = query.fromDate
      ? new Date(query.fromDate)
      : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const to = query.toDate ? new Date(query.toDate) : now;
    if (from > to || to.getUTCFullYear() - from.getUTCFullYear() > 100)
      throw new BadRequestException('Invalid report period');
    const ids = query.categories?.map((id) => new Types.ObjectId(id));
    if (
      ids &&
      (await this.categories.countDocuments({
        ...budget,
        _id: { $in: ids },
      })) !== new Set(ids.map(String)).size
    )
      throw new NotFoundException('Category not found');
    const categories = await this.categories
      .find({ ...budget, ...(ids ? { _id: { $in: ids } } : {}) })
      .lean();
    const rows: PeriodReport[] = [];
    let start = new Date(
      Date.UTC(from.getUTCFullYear(), yearly ? 0 : from.getUTCMonth(), 1),
    );
    while (start <= to) {
      const next = new Date(
        Date.UTC(
          start.getUTCFullYear() + (yearly ? 1 : 0),
          yearly ? 0 : start.getUTCMonth() + 1,
          1,
        ),
      );
      const end = new Date(next.getTime() - 1);
      const sums = await this.transactions.aggregate<{
        _id: { type: string; category?: Types.ObjectId };
        total: number;
      }>([
        {
          $match: {
            ...groupBudget(groupId),
            deletedAt: null,
            ...(ids
              ? {
                  $or: [
                    { type: { $ne: 'expense' } },
                    { category: { $in: ids } },
                  ],
                }
              : {}),
            transactionDate: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { type: '$type', category: '$category' },
            total: { $sum: '$amount' },
          },
        },
      ]);
      rows.push({
        period: yearly
          ? String(start.getUTCFullYear())
          : `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
        expenses: money(
          sums
            .filter((x) => x._id.type === 'expense')
            .reduce((sum, x) => sum + x.total, 0),
        ),
        incomes: money(
          sums
            .filter((x) => x._id.type === 'income')
            .reduce((sum, x) => sum + x.total, 0),
        ),
        saves: 0,
        saving: 0,
        balance: account ? await this.wallet.balance(account, end) : 0,
        expensesByCategory: categories.map((c) => ({
          categoryId: String(c._id),
          total: money(
            sums
              .filter(
                (x) =>
                  x._id.type === 'expense' &&
                  String(x._id.category) === String(c._id),
              )
              .reduce((sum, x) => sum + x.total, 0),
          ),
        })),
      });
      start = next;
    }
    return rows;
  }
}
