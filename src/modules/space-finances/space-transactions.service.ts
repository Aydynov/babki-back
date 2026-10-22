import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { spaceBudget } from 'src/common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { SpacesAccessService } from '../spaces/spaces-access.service';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { IncomesService } from '../transactions/incomes/incomes.service';
import {
  FinancialChanges,
  TransactionsService,
} from '../transactions/transactions/transactions.service';
import {
  CreateSpaceExpenseDto,
  CreateSpaceIncomeDto,
  SpaceExpensesQueryDto,
  UpdateSpaceExpenseDto,
  UpdateSpaceIncomeDto,
} from './dto/space-finances.dto';
import { SpaceFinancialActorsService } from './space-financial-actors.service';
export type SpaceTransactionKind = 'expense' | 'income';
@Injectable()
export class SpaceTransactionsService {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly expenses: ExpensesService,
    private readonly incomes: IncomesService,
    private readonly spaces: SpacesAccessService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly actors: SpaceFinancialActorsService,
  ) {}
  create(
    spaceId: string,
    actor: string,
    kind: SpaceTransactionKind,
    dto: CreateSpaceExpenseDto | CreateSpaceIncomeDto,
  ) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      const account = await this.transactions.accountForCreate(
        budget,
        dto.accountId,
        new Date(dto.transactionDate),
        session,
      );
      if (kind === 'expense') {
        const expense = dto as CreateSpaceExpenseDto;
        const participantId = expense.participantId ?? actor;
        await this.spaces.requireMember(spaceId, participantId, session);
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
    spaceId: string,
    actor: string,
    id: string,
    kind: SpaceTransactionKind,
  ) {
    await this.access.resolve(actor, spaceId);
    const row = await this.transactions.findOneForBudget(
      spaceBudget(spaceId),
      id,
      kind,
    );
    return this.actors.enrichOne(row);
  }
  change(
    spaceId: string,
    actor: string,
    id: string,
    kind: SpaceTransactionKind,
    dto?: UpdateSpaceExpenseDto | UpdateSpaceIncomeDto,
  ) {
    if (dto && !Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      const row = await this.transactions.findOneForBudget(
        budget,
        id,
        kind,
        session,
      );
      const { space, permissions } = await this.spaces.memberContext(
        spaceId,
        actor,
        session,
      );
      const isOwner = space.ownerId.equals(actor),
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
      const expense = dto as UpdateSpaceExpenseDto;
      if ('merchant' in dto) changes.merchant = expense.merchant;
      if ('items' in dto) changes.items = expense.items;
      if (
        'participantId' in dto &&
        dto.participantId !== undefined &&
        !row.participantId?.equals(dto.participantId)
      ) {
        if (!isOwner && !isAuthor && !permissions.manageTransactions)
          throw new ForbiddenException('Cannot reassign expense');
        await this.spaces.requireMember(spaceId, dto.participantId, session);
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
  private async validateFilters(spaceId: string, query: SpaceExpensesQueryDto) {
    const budget = spaceBudget(spaceId);
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
    spaceId: string,
    actor: string,
    query: SpaceExpensesQueryDto,
    kind?: SpaceTransactionKind,
  ) {
    await this.access.resolve(actor, spaceId);
    await this.validateFilters(spaceId, query);
    const result = await this.transactions.findAllForBudget(
      spaceBudget(spaceId),
      query,
      kind,
    );
    return { ...result, items: await this.actors.enrich(result.items) };
  }
  async revenue(spaceId: string, actor: string, query: SpaceExpensesQueryDto) {
    await this.access.resolve(actor, spaceId);
    await this.validateFilters(spaceId, query);
    return this.transactions.findRevenueForBudget(
      spaceBudget(spaceId),
      query,
      'expense',
    );
  }
}
