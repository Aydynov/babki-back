import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { groupBudget } from '../../common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { GroupsAccessService } from '../groups/groups-access.service';
import { TransfersService } from '../transactions/transfers/transfers.service';
import {
  CreateGroupTransferDto,
  GroupTransfersQueryDto,
  UpdateGroupTransferDto,
} from './dto/group-transfers.dto';

@Injectable()
export class GroupTransfersService {
  constructor(
    private readonly transfers: TransfersService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly groups: GroupsAccessService,
  ) {}
  create(groupId: string, actorId: string, dto: CreateGroupTransferDto) {
    const budget = groupBudget(groupId);
    return this.write.run(budget, actorId, (session) =>
      this.transfers.createForBudget(budget, actorId, dto, session),
    );
  }
  async list(groupId: string, actorId: string, query: GroupTransfersQueryDto) {
    const budget = await this.access.resolve(actorId, groupId);
    if (query.accountId) await this.access.account(budget, query.accountId);
    if (
      query.fromDate &&
      query.toDate &&
      new Date(query.fromDate) > new Date(query.toDate)
    )
      throw new BadRequestException('Invalid period');
    return this.transfers.findAllForBudget(budget, query);
  }
  async get(groupId: string, actorId: string, id: string) {
    return this.transfers.findOneForBudget(
      await this.access.resolve(actorId, groupId),
      id,
    );
  }
  change(
    groupId: string,
    actorId: string,
    id: string,
    dto?: UpdateGroupTransferDto,
  ) {
    if (dto && !Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = groupBudget(groupId);
    return this.write.run(budget, actorId, async (session) => {
      const row = await this.transfers.getStoredForBudget(budget, id, session);
      const { group, permissions } = await this.groups.memberContext(
        groupId,
        actorId,
        session,
      );
      if (
        !group.ownerId.equals(actorId) &&
        !row.createdBy.equals(actorId) &&
        !permissions.manageTransactions
      )
        throw new ForbiddenException('Transaction mutation not permitted');
      return dto
        ? this.transfers.updateForBudget(budget, id, dto, session)
        : this.transfers.deleteForBudget(budget, actorId, id, session);
    });
  }
}
