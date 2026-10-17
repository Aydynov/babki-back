import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { groupBudget } from 'src/common/budget/budget-context';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { GroupsAccessService } from '../groups/groups-access.service';
import { DebtsService } from '../debts/debts.service';
import { DebtTransactionsService } from '../debt-transactions/debt-transactions.service';
import {
  CreateGroupDebtDto,
  GroupDebtsQueryDto,
  RepayGroupDebtDto,
  UpdateGroupDebtDto,
} from './dto/group-debts.dto';
import { GroupFinancialActorsService } from './group-financial-actors.service';

@Injectable()
export class GroupDebtsService {
  constructor(
    private readonly debts: DebtsService,
    private readonly history: DebtTransactionsService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly groups: GroupsAccessService,
    private readonly actors: GroupFinancialActorsService,
  ) {}

  create(groupId: string, actor: string, dto: CreateGroupDebtDto) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      const row = await this.debts.createForBudget(budget, actor, dto, session);
      return this.actors.enrichOne(row, session);
    });
  }

  async list(groupId: string, actor: string, query: GroupDebtsQueryDto) {
    await this.access.resolve(actor, groupId);
    const result = await this.debts.listForBudget(groupBudget(groupId), query);
    return { ...result, items: await this.actors.enrich(result.items) };
  }

  async get(groupId: string, actor: string, id: string) {
    await this.access.resolve(actor, groupId);
    return this.actors.enrichOne(
      await this.debts.getForBudget(groupBudget(groupId), id),
    );
  }

  async repayments(
    groupId: string,
    actor: string,
    id: string,
    query: PaginationQueryDto,
  ) {
    await this.access.resolve(actor, groupId);
    const result = await this.history.listForBudget(
      groupBudget(groupId),
      id,
      query,
    );
    return { ...result, items: await this.actors.enrich(result.items) };
  }

  async repayment(
    groupId: string,
    actor: string,
    id: string,
    repaymentId: string,
  ) {
    await this.access.resolve(actor, groupId);
    return this.actors.enrichOne(
      await this.history.getForBudget(groupBudget(groupId), id, repaymentId),
    );
  }

  private async requireMutation(
    groupId: string,
    actor: string,
    id: string,
    session: ClientSession,
  ) {
    const row = await this.debts.getForBudget(
      groupBudget(groupId),
      id,
      session,
    );
    const { group, permissions } = await this.groups.memberContext(
      groupId,
      actor,
      session,
    );
    if (
      !group.ownerId.equals(actor) &&
      !row.createdBy.equals(actor) &&
      !permissions.manageTransactions
    )
      throw new ForbiddenException('Debt mutation not permitted');
  }

  update(groupId: string, actor: string, id: string, dto: UpdateGroupDebtDto) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      const row = await this.debts.updateForBudget(budget, id, dto, session);
      if (!row) throw new NotFoundException('Debt not found');
      return this.actors.enrichOne(row, session);
    });
  }

  repay(groupId: string, actor: string, id: string, dto: RepayGroupDebtDto) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      const result = await this.debts.repayForBudget(
        budget,
        actor,
        id,
        dto,
        session,
      );
      const [debt, repayment] = await this.actors.enrich(
        [result.debt, result.repayment],
        session,
      );
      return { debt, repayment };
    });
  }

  cancel(groupId: string, actor: string, id: string, repaymentId: string) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      const result = await this.debts.cancelRepaymentForBudget(
        budget,
        actor,
        id,
        repaymentId,
        session,
      );
      const [debt, repayment] = await this.actors.enrich(
        [result.debt, result.repayment],
        session,
      );
      return { debt, repayment };
    });
  }

  archive(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      await this.debts.archiveForBudget(budget, id, session);
    });
  }

  remove(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      await this.debts.removeForBudget(budget, id, session);
    });
  }
}
