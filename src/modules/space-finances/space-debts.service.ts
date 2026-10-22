import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { spaceBudget } from 'src/common/budget/budget-context';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { DebtTransactionsService } from '../debt-transactions/debt-transactions.service';
import { DebtsService } from '../debts/debts.service';
import { SpacesAccessService } from '../spaces/spaces-access.service';
import {
  CreateSpaceDebtDto,
  RepaySpaceDebtDto,
  SpaceDebtsQueryDto,
  UpdateSpaceDebtDto,
} from './dto/space-debts.dto';
import { SpaceFinancialActorsService } from './space-financial-actors.service';
@Injectable()
export class SpaceDebtsService {
  constructor(
    private readonly debts: DebtsService,
    private readonly history: DebtTransactionsService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly spaces: SpacesAccessService,
    private readonly actors: SpaceFinancialActorsService,
  ) {}
  create(spaceId: string, actor: string, dto: CreateSpaceDebtDto) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      const row = await this.debts.createForBudget(budget, actor, dto, session);
      return this.actors.enrichOne(row, session);
    });
  }
  async list(spaceId: string, actor: string, query: SpaceDebtsQueryDto) {
    await this.access.resolve(actor, spaceId);
    const result = await this.debts.listForBudget(spaceBudget(spaceId), query);
    return { ...result, items: await this.actors.enrich(result.items) };
  }
  async get(spaceId: string, actor: string, id: string) {
    await this.access.resolve(actor, spaceId);
    return this.actors.enrichOne(
      await this.debts.getForBudget(spaceBudget(spaceId), id),
    );
  }
  async repayments(
    spaceId: string,
    actor: string,
    id: string,
    query: PaginationQueryDto,
  ) {
    await this.access.resolve(actor, spaceId);
    const result = await this.history.listForBudget(
      spaceBudget(spaceId),
      id,
      query,
    );
    return { ...result, items: await this.actors.enrich(result.items) };
  }
  async repayment(
    spaceId: string,
    actor: string,
    id: string,
    repaymentId: string,
  ) {
    await this.access.resolve(actor, spaceId);
    return this.actors.enrichOne(
      await this.history.getForBudget(spaceBudget(spaceId), id, repaymentId),
    );
  }
  private async requireMutation(
    spaceId: string,
    actor: string,
    id: string,
    session: ClientSession,
  ) {
    const row = await this.debts.getForBudget(
      spaceBudget(spaceId),
      id,
      session,
    );
    const { space, permissions } = await this.spaces.memberContext(
      spaceId,
      actor,
      session,
    );
    if (
      !space.ownerId.equals(actor) &&
      !row.createdBy.equals(actor) &&
      !permissions.manageTransactions
    )
      throw new ForbiddenException('Debt mutation not permitted');
  }
  update(spaceId: string, actor: string, id: string, dto: UpdateSpaceDebtDto) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      const row = await this.debts.updateForBudget(budget, id, dto, session);
      if (!row) throw new NotFoundException('Debt not found');
      return this.actors.enrichOne(row, session);
    });
  }
  repay(spaceId: string, actor: string, id: string, dto: RepaySpaceDebtDto) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
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
  cancel(spaceId: string, actor: string, id: string, repaymentId: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
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
  archive(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      await this.debts.archiveForBudget(budget, id, session);
    });
  }
  remove(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      await this.debts.removeForBudget(budget, id, session);
    });
  }
}
