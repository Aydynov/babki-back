import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, HydratedDocument, Model, Types } from 'mongoose';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { Expense } from '../transactions/schemas/expense.schema';
import { Income } from '../transactions/schemas/income.schema';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { GroupsAccessService } from '../groups/groups-access.service';
import { BudgetAccessService, groupBudget } from './budget-access.service';
import { GroupFinanceWriteService } from './group-finance-write.service';
import { GroupWalletService, money } from './group-wallet.service';
import {
  CreateGroupExpenseDto,
  CreateGroupIncomeDto,
  GroupExpensesQueryDto,
  UpdateGroupExpenseDto,
  UpdateGroupIncomeDto,
} from './dto/group-finances.dto';
import { getPagination } from '../../common/utils/pagination.util';
export type GroupTransactionKind = 'expense' | 'income';
@Injectable()
export class GroupTransactionsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactions: Model<Transaction>,
    @InjectModel(Expense.name) private readonly expenses: Model<Expense>,
    @InjectModel(Income.name) private readonly incomes: Model<Income>,
    @InjectModel(ExpenseCategory.name)
    private readonly categories: Model<ExpenseCategory>,
    private readonly groups: GroupsAccessService,
    private readonly access: BudgetAccessService,
    private readonly write: GroupFinanceWriteService,
    private readonly wallet: GroupWalletService,
  ) {}
  async category(groupId: string, id: string, session: ClientSession) {
    const category = await this.categories
      .findOne({ _id: id, ...groupBudget(groupId) })
      .session(session);
    if (!category) throw new NotFoundException('Category not found');
    if (category.isArchived)
      throw new ConflictException('Category is archived');
    return category;
  }
  async create(
    groupId: string,
    actor: string,
    kind: GroupTransactionKind,
    dto: CreateGroupExpenseDto | CreateGroupIncomeDto,
  ) {
    return this.write.run(groupId, actor, async (session) => {
      const account = await this.access.account(
        groupBudget(groupId),
        dto.accountId,
        session,
      );
      const date = new Date(dto.transactionDate);
      if (date < account.openedAt!)
        throw new BadRequestException('Transaction predates wallet');
      const data = {
        ...groupBudget(groupId),
        accountId: account._id,
        createdBy: new Types.ObjectId(actor),
        amount: dto.amount,
        transactionDate: date,
        description: dto.description,
      };
      // The monthly cache is created inside the same transaction as the operation.
      await this.wallet.rebuild(account, date, session);
      const snapshot = await this.snapshotId(account._id, date, session);
      let record: HydratedDocument<Expense> | HydratedDocument<Income>;
      if (kind === 'expense') {
        const expense = dto as CreateGroupExpenseDto;
        const participant = expense.participantId ?? actor;
        await this.groups.requireMember(groupId, participant, session);
        const category = await this.category(
          groupId,
          expense.categoryId,
          session,
        );
        [record] = await this.expenses.create(
          [
            {
              ...data,
              snapshotId: snapshot,
              category: category._id,
              participantId: new Types.ObjectId(participant),
              merchant: expense.merchant,
              items: expense.items ?? [],
            },
          ],
          { session },
        );
      } else
        [record] = await this.incomes.create(
          [{ ...data, snapshotId: snapshot }],
          { session },
        );
      await this.wallet.rebuild(account, date, session);
      return record.toObject();
    });
  }
  @InjectModel('AccountSnapshot') private readonly snapshots: Model<{
    accountId: Types.ObjectId;
    date: Date;
  }>;
  private async snapshotId(
    accountId: Types.ObjectId,
    date: Date,
    session: ClientSession,
  ) {
    const end = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1,
    );
    const snapshot = await this.snapshots
      .findOne({ accountId, date: end })
      .session(session);
    if (!snapshot) throw new NotFoundException('Snapshot not found');
    return snapshot._id;
  }
  private async record(
    groupId: string,
    id: string,
    kind: GroupTransactionKind,
    session?: ClientSession,
  ) {
    const row = await this.transactions
      .findOne({
        _id: id,
        type: kind,
        ...groupBudget(groupId),
        deletedAt: null,
      })
      .session(session ?? null)
      .lean<
        Transaction & {
          _id: Types.ObjectId;
          participantId?: Types.ObjectId;
          category?: Types.ObjectId;
        }
      >();
    if (!row) throw new NotFoundException('Transaction not found');
    return row;
  }
  async get(
    groupId: string,
    actor: string,
    id: string,
    kind: GroupTransactionKind,
  ) {
    await this.access.resolve(actor, groupId);
    return this.record(groupId, id, kind);
  }
  async change(
    groupId: string,
    actor: string,
    id: string,
    kind: GroupTransactionKind,
    dto?: UpdateGroupExpenseDto | UpdateGroupIncomeDto,
  ) {
    if (dto && !Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    return this.write.run(groupId, actor, async (session) => {
      const row = await this.record(groupId, id, kind, session);
      const group = await this.groups.requireMember(groupId, actor, session);
      const isOwner = group.ownerId.equals(actor),
        isAuthor = row.createdBy.equals(actor);
      if (!isOwner && !isAuthor && !row.participantId?.equals(actor))
        throw new ForbiddenException('Transaction mutation not permitted');
      const account = await this.access.account(
        groupBudget(groupId),
        String(row.accountId),
        session,
      );
      const fields: Record<string, unknown> = {};
      if (!dto) {
        fields.deletedAt = new Date();
        fields.deletedBy = new Types.ObjectId(actor);
      } else {
        for (const key of [
          'amount',
          'description',
          'merchant',
          'items',
        ] as const)
          if (key in dto) fields[key] = dto[key];
        if (
          'participantId' in dto &&
          dto.participantId !== undefined &&
          !row.participantId?.equals(dto.participantId)
        ) {
          if (!isOwner && !isAuthor)
            throw new ForbiddenException('Cannot reassign expense');
          await this.groups.requireMember(groupId, dto.participantId, session);
          fields.participantId = new Types.ObjectId(dto.participantId);
        }
        if (
          'categoryId' in dto &&
          dto.categoryId !== undefined &&
          !row.category?.equals(dto.categoryId)
        )
          fields.category = (
            await this.category(groupId, dto.categoryId, session)
          )._id;
      }
      const model: Model<Transaction> =
        kind === 'expense'
          ? (this.expenses as Model<Transaction>)
          : this.incomes;
      const result = await model
        .findOneAndUpdate(
          { _id: row._id },
          { $set: fields },
          { session, returnDocument: 'after', runValidators: true },
        )
        .lean();
      await this.wallet.rebuild(account, row.transactionDate, session);
      return result;
    });
  }
  private async filter(
    groupId: string,
    query: GroupExpensesQueryDto,
    kind?: GroupTransactionKind,
  ) {
    const filter: Record<string, unknown> = {
      ...groupBudget(groupId),
      deletedAt: null,
    };
    if (kind) filter.type = kind;
    else if (query.transactionType) filter.type = query.transactionType;
    if (query.accountId) {
      await this.access.account(groupBudget(groupId), query.accountId);
      filter.accountId = new Types.ObjectId(query.accountId);
    }
    if (query.categoryId) {
      if (
        !(await this.categories.exists({
          _id: query.categoryId,
          ...groupBudget(groupId),
        }))
      )
        throw new NotFoundException('Category not found');
      filter.category = new Types.ObjectId(query.categoryId);
    }
    if (query.participantId)
      filter.participantId = new Types.ObjectId(query.participantId);
    if (query.fromDate || query.toDate) {
      if (
        query.fromDate &&
        query.toDate &&
        new Date(query.fromDate) > new Date(query.toDate)
      )
        throw new BadRequestException('Invalid period');
      filter.transactionDate = {
        ...(query.fromDate ? { $gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { $lte: new Date(query.toDate) } : {}),
      };
    }
    return filter;
  }
  async list(
    groupId: string,
    actor: string,
    query: GroupExpensesQueryDto,
    kind?: GroupTransactionKind,
  ) {
    await this.access.resolve(actor, groupId);
    const filter = await this.filter(groupId, query, kind);
    const { page, limit, skip } = getPagination(query);
    const [items, total] = await Promise.all([
      this.transactions
        .find(filter)
        .sort({ transactionDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.transactions.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
  async revenue(groupId: string, actor: string, query: GroupExpensesQueryDto) {
    await this.access.resolve(actor, groupId);
    const filter = await this.filter(groupId, query, 'expense');
    const result = await this.transactions.aggregate<{ total: number }>([
      { $match: filter },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      totalRevenue: money(result[0]?.total ?? 0),
    };
  }
}
