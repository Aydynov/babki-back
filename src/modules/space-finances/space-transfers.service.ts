import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { spaceBudget } from '../../common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { SpacesAccessService } from '../spaces/spaces-access.service';
import { TransfersService } from '../transactions/transfers/transfers.service';
import {
  CreateSpaceTransferDto,
  SpaceTransfersQueryDto,
  UpdateSpaceTransferDto,
} from './dto/space-transfers.dto';
import { SpaceFinancialActorsService } from './space-financial-actors.service';
@Injectable()
export class SpaceTransfersService {
  constructor(
    private readonly transfers: TransfersService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
    private readonly spaces: SpacesAccessService,
    private readonly actors: SpaceFinancialActorsService,
  ) {}
  create(spaceId: string, actorId: string, dto: CreateSpaceTransferDto) {
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actorId, async (session) => {
      const row = await this.transfers.createForBudget(
        budget,
        actorId,
        dto,
        session,
      );
      return this.actors.enrichOne(row, session);
    });
  }
  async list(spaceId: string, actorId: string, query: SpaceTransfersQueryDto) {
    const budget = await this.access.resolve(actorId, spaceId);
    if (query.accountId) await this.access.account(budget, query.accountId);
    if (
      query.fromDate &&
      query.toDate &&
      new Date(query.fromDate) > new Date(query.toDate)
    )
      throw new BadRequestException('Invalid period');
    const result = await this.transfers.findAllForBudget(budget, query);
    return { ...result, items: await this.actors.enrich(result.items) };
  }
  async get(spaceId: string, actorId: string, id: string) {
    const row = await this.transfers.findOneForBudget(
      await this.access.resolve(actorId, spaceId),
      id,
    );
    return this.actors.enrichOne(row);
  }
  change(
    spaceId: string,
    actorId: string,
    id: string,
    dto?: UpdateSpaceTransferDto,
  ) {
    if (dto && !Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
    const budget = spaceBudget(spaceId);
    return this.write.run(budget, actorId, async (session) => {
      const row = await this.transfers.getStoredForBudget(budget, id, session);
      const { space, permissions } = await this.spaces.memberContext(
        spaceId,
        actorId,
        session,
      );
      if (
        !space.ownerId.equals(actorId) &&
        !row.createdBy.equals(actorId) &&
        !permissions.manageTransactions
      )
        throw new ForbiddenException('Transaction mutation not permitted');
      if (!dto)
        return this.transfers.deleteForBudget(budget, actorId, id, session);
      const updated = await this.transfers.updateForBudget(
        budget,
        id,
        dto,
        session,
      );
      return this.actors.enrichOne(updated, session);
    });
  }
}
