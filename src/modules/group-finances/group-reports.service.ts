import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { GroupReportsQueryDto } from './dto/group-finances.dto';
import { ReportsService, ReportPeriod } from '../reports/reports.service';
import { PeriodReport } from '../reports/interfaces/period-report.interface';
@Injectable()
export class GroupReportsService {
  constructor(
    @InjectModel(ExpenseCategory.name)
    private readonly categories: Model<ExpenseCategory>,
    private readonly access: BudgetAccessService,
    private readonly reports: ReportsService,
  ) {}
  async report(
    groupId: string,
    actor: string,
    query: GroupReportsQueryDto,
    yearly = false,
  ): Promise<PeriodReport[]> {
    const budget = await this.access.resolve(actor, groupId);
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
    const periods: ReportPeriod[] = [];
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
      periods.push({
        period: yearly
          ? String(start.getUTCFullYear())
          : `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
        endDate: end,
      });
      start = next;
    }
    return this.reports.reportForBudget(
      budget,
      periods,
      yearly ? 'year' : 'month',
      categories.map((category) => String(category._id)),
      !!ids,
    );
  }
}
