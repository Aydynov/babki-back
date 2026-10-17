import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { groupBudget } from 'src/common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { GroupsAccessService } from '../groups/groups-access.service';
import { PlansService } from '../plans/plans.service';
import {
  CloseGroupPlanDto,
  CreateGroupPlanDto,
  GroupPlansQueryDto,
  UpdateGroupPlanDto,
} from './dto/group-plans.dto';
import { GroupFinancialActorsService } from './group-financial-actors.service';

@Injectable()
export class GroupPlansService {
  constructor(
    private readonly plans: PlansService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly groups: GroupsAccessService,
    private readonly actors: GroupFinancialActorsService,
  ) {}

  create(groupId: string, actor: string, dto: CreateGroupPlanDto) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      const row = await this.plans.createForBudget(budget, actor, dto, session);
      return this.actors.enrichOne(row, session);
    });
  }

  async list(groupId: string, actor: string, query: GroupPlansQueryDto) {
    await this.access.resolve(actor, groupId);
    const result = await this.plans.listForBudget(groupBudget(groupId), query);
    return { ...result, items: await this.actors.enrich(result.items) };
  }

  async get(groupId: string, actor: string, id: string) {
    await this.access.resolve(actor, groupId);
    return this.actors.enrichOne(
      await this.plans.getForBudget(groupBudget(groupId), id),
    );
  }

  private async requireMutation(
    groupId: string,
    actor: string,
    id: string,
    session: ClientSession,
  ) {
    const row = await this.plans.getForBudget(
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
      throw new ForbiddenException('Plan mutation not permitted');
  }

  update(groupId: string, actor: string, id: string, dto: UpdateGroupPlanDto) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      const row = await this.plans.updateForBudget(budget, id, dto, session);
      if (!row) throw new NotFoundException('Plan not found');
      return this.actors.enrichOne(row, session);
    });
  }

  close(groupId: string, actor: string, id: string, dto: CloseGroupPlanDto) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      await this.groups.requireMember(
        groupId,
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

  archive(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      await this.plans.archiveForBudget(budget, id, session);
    });
  }

  remove(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actor, async (session) => {
      await this.requireMutation(groupId, actor, id, session);
      await this.plans.removeForBudget(budget, id, session);
    });
  }
}
