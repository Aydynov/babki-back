import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { groupBudget } from 'src/common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { GroupsAccessService } from '../groups/groups-access.service';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { IncomesService } from '../transactions/incomes/incomes.service';
import {
  FinancialChanges,
  TransactionsService,
} from '../transactions/transactions/transactions.service';
import {
  CreateGroupExpenseDto,
  CreateGroupIncomeDto,
  GroupExpensesQueryDto,
  UpdateGroupExpenseDto,
  UpdateGroupIncomeDto,
} from './dto/group-finances.dto';
import { GroupFinancialActorsService } from './group-financial-actors.service';

export type GroupTransactionKind = 'expense' | 'income';

@Injectable()
export class GroupTransactionsService {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly expenses: ExpensesService,
    private readonly incomes: IncomesService,
    private readonly groups: GroupsAccessService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly actors: GroupFinancialActorsService,
  ) {}

  create(
    groupId: string,
    actor: string,
    kind: GroupTransactionKind,
    dto: CreateGroupExpenseDto | CreateGroupIncomeDto,
  ) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      const account = await this.transactions.accountForCreate(
        budget,
        dto.accountId,
        new Date(dto.transactionDate),
        session,
      );
      if (kind === 'expense') {
        const expense = dto as CreateGroupExpenseDto;
        const participantId = expense.participantId ?? actor;
        await this.groups.requireMember(groupId, participantId, session);
        const row = await this.expenses.createForBudget(
          budget,
          actor,
          { ...expense, participantId },
          session,
          undefined,
          account,
        );
        return this.actors.enrichOne(row, session);
      }
      const row = await this.incomes.createForBudget(
        budget,
        actor,
        dto,
        session,
        undefined,
        account,
      );
      return this.actors.enrichOne(row, session);
    });
  }

  async get(
    groupId: string,
    actor: string,
    id: string,
    kind: GroupTransactionKind,
  ) {
    await this.access.resolve(actor, groupId);
    const row = await this.transactions.findOneForBudget(
      groupBudget(groupId),
      id,
      kind,
    );
    return this.actors.enrichOne(row);
  }

  change(
    groupId: string,
    actor: string,
    id: string,
    kind: GroupTransactionKind,
    dto?: UpdateGroupExpenseDto | UpdateGroupIncomeDto,
  ) {
    if (dto && !Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      const row = await this.transactions.findOneForBudget(
        budget,
        id,
        kind,
        session,
      );
      const { group, permissions } = await this.groups.memberContext(
        groupId,
        actor,
        session,
      );
      const isOwner = group.ownerId.equals(actor),
        isAuthor = row.createdBy.equals(actor);
      if (
        !isOwner &&
        !isAuthor &&
        !row.participantId?.equals(actor) &&
        !permissions.manageTransactions
      )
        throw new ForbiddenException('Transaction mutation not permitted');
      const account = await this.transactions.accountForBudget(
        budget,
        row.accountId.toString(),
        session,
      );
      if (kind === 'income' && row.origin?.type === 'debt')
        throw new ConflictException(
          'Cancel the debt repayment to change this income',
        );
      if (!dto)
        return this.transactions.deleteForBudget(
          budget,
          actor,
          row,
          session,
          account,
        );
      const changes: FinancialChanges = {};
      if ('amount' in dto) changes.amount = dto.amount;
      if ('description' in dto) changes.description = dto.description;
      const expense = dto as UpdateGroupExpenseDto;
      if ('merchant' in dto) changes.merchant = expense.merchant;
      if ('items' in dto) changes.items = expense.items;
      if (
        'participantId' in dto &&
        dto.participantId !== undefined &&
        !row.participantId?.equals(dto.participantId)
      ) {
        if (!isOwner && !isAuthor && !permissions.manageTransactions)
          throw new ForbiddenException('Cannot reassign expense');
        await this.groups.requireMember(groupId, dto.participantId, session);
        changes.participantId = new Types.ObjectId(dto.participantId);
      }
      if (
        'categoryId' in dto &&
        dto.categoryId !== undefined &&
        !row.category?.equals(dto.categoryId)
      )
        changes.category = (
          await this.expenses.categoryForBudget(budget, dto.categoryId, session)
        )._id;
      const updated =
        kind === 'expense'
          ? await this.expenses.updateForBudget(
              budget,
              row,
              changes,
              session,
              account,
            )
          : await this.incomes.updateForBudget(
              budget,
              row,
              changes,
              session,
              account,
            );
      return this.actors.enrichOne(updated, session);
    });
  }

  private async validateFilters(groupId: string, query: GroupExpensesQueryDto) {
    const budget = groupBudget(groupId);
    if (query.accountId) await this.access.account(budget, query.accountId);
    if (query.categoryId)
      await this.expenses.requireCategoryForBudget(budget, query.categoryId);
    if (
      query.fromDate &&
      query.toDate &&
      new Date(query.fromDate) > new Date(query.toDate)
    )
      throw new BadRequestException('Invalid period');
  }

  async list(
    groupId: string,
    actor: string,
    query: GroupExpensesQueryDto,
    kind?: GroupTransactionKind,
  ) {
    await this.access.resolve(actor, groupId);
    await this.validateFilters(groupId, query);
    const result = await this.transactions.findAllForBudget(
      groupBudget(groupId),
      query,
      kind,
    );
    return { ...result, items: await this.actors.enrich(result.items) };
  }

  async revenue(groupId: string, actor: string, query: GroupExpensesQueryDto) {
    await this.access.resolve(actor, groupId);
    await this.validateFilters(groupId, query);
    return this.transactions.findRevenueForBudget(
      groupBudget(groupId),
      query,
      'expense',
    );
  }
}
