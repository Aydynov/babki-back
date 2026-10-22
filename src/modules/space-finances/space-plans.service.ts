import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { spaceBudget } from 'src/common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { PlansService } from '../plans/plans.service';
import { SpacesAccessService } from '../spaces/spaces-access.service';
import {
  CloseSpacePlanDto,
  CreateSpacePlanDto,
  SpacePlansQueryDto,
  UpdateSpacePlanDto,
} from './dto/space-plans.dto';
import { SpaceFinancialActorsService } from './space-financial-actors.service';
@Injectable()
export class SpacePlansService {
  constructor(
    private readonly plans: PlansService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly spaces: SpacesAccessService,
    private readonly actors: SpaceFinancialActorsService,
  ) {}
  create(spaceId: string, actor: string, dto: CreateSpacePlanDto) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      const row = await this.plans.createForBudget(budget, actor, dto, session);
      return this.actors.enrichOne(row, session);
    });
  }
  async list(spaceId: string, actor: string, query: SpacePlansQueryDto) {
    await this.access.resolve(actor, spaceId);
    const result = await this.plans.listForBudget(spaceBudget(spaceId), query);
    return { ...result, items: await this.actors.enrich(result.items) };
  }
  async get(spaceId: string, actor: string, id: string) {
    await this.access.resolve(actor, spaceId);
    return this.actors.enrichOne(
      await this.plans.getForBudget(spaceBudget(spaceId), id),
    );
  }
  private async requireMutation(
    spaceId: string,
    actor: string,
    id: string,
    session: ClientSession,
  ) {
    const row = await this.plans.getForBudget(
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
      throw new ForbiddenException('Plan mutation not permitted');
  }
  update(spaceId: string, actor: string, id: string, dto: UpdateSpacePlanDto) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      const row = await this.plans.updateForBudget(budget, id, dto, session);
      if (!row) throw new NotFoundException('Plan not found');
      return this.actors.enrichOne(row, session);
    });
  }
  close(spaceId: string, actor: string, id: string, dto: CloseSpacePlanDto) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      await this.spaces.requireMember(
        spaceId,
        dto.participantId ?? actor,
        session,
      );
      const row = await this.plans.closeForBudget(
        budget,
        actor,
        id,
        dto,
        session,
      );
      return this.actors.enrichOne(row, session);
    });
  }
  archive(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      await this.plans.archiveForBudget(budget, id, session);
    });
  }
  remove(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(spaceId, actor, id, session);
      await this.plans.removeForBudget(budget, id, session);
    });
  }
}
