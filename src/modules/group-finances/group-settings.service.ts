import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { ExpenseLimit } from '../expense-limits/schemas/expense-limit.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { BudgetAccessService, groupBudget } from './budget-access.service';
import { GroupFinanceWriteService } from './group-finance-write.service';
import {
  CreateGroupCategoryDto,
  UpdateGroupCategoryDto,
  CreateGroupLimitDto,
  UpdateGroupLimitDto,
  GroupLimitsQueryDto,
} from './dto/group-finances.dto';
import { money } from './group-wallet.service';
const dayStart = (value: string | Date) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const dayEnd = (value: string | Date) => {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
};
@Injectable()
export class GroupSettingsService {
  constructor(
    @InjectModel(ExpenseCategory.name)
    private readonly categories: Model<ExpenseCategory>,
    @InjectModel(ExpenseLimit.name)
    private readonly limits: Model<ExpenseLimit>,
    @InjectModel(Transaction.name)
    private readonly transactions: Model<Transaction>,
    private readonly access: BudgetAccessService,
    private readonly write: GroupFinanceWriteService,
  ) {}
  private async category(groupId: string, id: string, session?: ClientSession) {
    const item = await this.categories
      .findOne({ _id: id, ...groupBudget(groupId) })
      .session(session ?? null);
    if (!item) throw new NotFoundException('Category not found');
    return item;
  }
  async listCategories(groupId: string, actor: string) {
    await this.access.resolve(actor, groupId);
    return this.categories
      .find(groupBudget(groupId))
      .sort({ createdAt: -1 })
      .lean();
  }
  async getCategory(groupId: string, actor: string, id: string) {
    await this.access.resolve(actor, groupId);
    return (await this.category(groupId, id)).toObject();
  }
  async saveCategory(
    groupId: string,
    actor: string,
    dto: CreateGroupCategoryDto | UpdateGroupCategoryDto,
    id?: string,
  ) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    return this.write.run(
      groupId,
      actor,
      async (session) => {
        if (id) await this.category(groupId, id, session);
        if (
          dto.name &&
          (await this.categories
            .exists({
              ...groupBudget(groupId),
              name: dto.name,
              ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}),
            })
            .session(session))
        )
          throw new ConflictException('Category name already exists');
        if (id)
          return this.categories
            .findOneAndUpdate(
              { _id: id, ...groupBudget(groupId) },
              { $set: dto },
              { session, returnDocument: 'after', runValidators: true },
            )
            .lean();
        const [row] = await this.categories.create(
          [{ ...groupBudget(groupId), ...dto }],
          { session },
        );
        return row.toObject();
      },
      'manageCategories',
    );
  }
  async removeCategory(groupId: string, actor: string, id: string) {
    await this.write.run(
      groupId,
      actor,
      async (session) => {
        const row = await this.category(groupId, id, session);
        if (
          (await this.transactions
            .exists({ ...groupBudget(groupId), category: row._id })
            .session(session)) ||
          (await this.limits
            .exists({ ...groupBudget(groupId), category: row._id })
            .session(session))
        )
          throw new ConflictException('Category is in use');
        await this.categories.deleteOne({ _id: row._id }, { session });
      },
      'manageCategories',
    );
  }
  private async limit(groupId: string, id: string, session?: ClientSession) {
    const row = await this.limits
      .findOne({ _id: id, ...groupBudget(groupId) })
      .session(session ?? null);
    if (!row) throw new NotFoundException('Limit not found');
    return row;
  }
  private async limitResponse(
    row: ExpenseLimit & { _id: Types.ObjectId },
    session?: ClientSession,
  ) {
    const sums = await this.transactions
      .aggregate<{ total: number }>([
        {
          $match: {
            ownerType: row.ownerType,
            ownerId: row.ownerId,
            type: 'expense',
            deletedAt: null,
            category: row.category,
            transactionDate: { $gte: row.startDate, $lte: row.endDate },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .session(session ?? null);
    return { ...row, rest: money(row.total - (sums[0]?.total ?? 0)) };
  }
  async listLimits(groupId: string, actor: string, query: GroupLimitsQueryDto) {
    await this.access.resolve(actor, groupId);
    if (query.categoryId) await this.category(groupId, query.categoryId);
    const filter = {
      ...groupBudget(groupId),
      ...(query.categoryId
        ? { category: new Types.ObjectId(query.categoryId) }
        : {}),
      ...(query.periodDate
        ? {
            startDate: { $lte: new Date(query.periodDate) },
            endDate: { $gte: new Date(query.periodDate) },
          }
        : {}),
    };
    const rows = await this.limits.find(filter).sort({ startDate: -1 }).lean();
    return Promise.all(rows.map((row) => this.limitResponse(row)));
  }
  async getLimit(groupId: string, actor: string, id: string) {
    await this.access.resolve(actor, groupId);
    return this.limitResponse((await this.limit(groupId, id)).toObject());
  }
  async saveLimit(
    groupId: string,
    actor: string,
    dto: CreateGroupLimitDto | UpdateGroupLimitDto,
    id?: string,
  ) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    return this.write.run(
      groupId,
      actor,
      async (session) => {
        const old = id ? await this.limit(groupId, id, session) : null;
        const category = await this.category(
          groupId,
          old ? String(old.category) : (dto as CreateGroupLimitDto).categoryId,
          session,
        );
        if (!old && category.isArchived)
          throw new ConflictException('Category is archived');
        const now = new Date();
        const startDate = dayStart(
          dto.startDate ??
            old?.startDate ??
            new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        );
        const endDate = dayEnd(
          dto.endDate ??
            old?.endDate ??
            new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
        );
        if (startDate > endDate)
          throw new BadRequestException('Invalid limit period');
        if (
          await this.limits
            .exists({
              ...groupBudget(groupId),
              category: category._id,
              startDate: { $lte: endDate },
              endDate: { $gte: startDate },
              ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}),
            })
            .session(session)
        )
          throw new ConflictException('Limit period overlaps');
        const data = {
          ...groupBudget(groupId),
          category: category._id,
          startDate,
          endDate,
          total: dto.total ?? old!.total,
        };
        const row = old
          ? await this.limits.findOneAndUpdate(
              { _id: old._id },
              { $set: data },
              { session, returnDocument: 'after', runValidators: true },
            )
          : (await this.limits.create([data], { session }))[0];
        return this.limitResponse(row!.toObject(), session);
      },
      'manageLimits',
    );
  }
  async removeLimit(groupId: string, actor: string, id: string) {
    await this.write.run(
      groupId,
      actor,
      async (session) => {
        const row = await this.limit(groupId, id, session);
        await this.limits.deleteOne({ _id: row._id }, { session });
      },
      'manageLimits',
    );
  }
}
