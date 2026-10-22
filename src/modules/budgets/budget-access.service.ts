import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
  BudgetContext,
  budgetFilter,
  spaceBudget,
} from 'src/common/budget/budget-context';
import { Account } from '../accounts/schemas/accounts.schema';
import { SpacesAccessService } from '../spaces/spaces-access.service';
@Injectable()
export class BudgetAccessService {
  constructor(
    @InjectModel(Account.name)
    private readonly accounts: Model<Account>,
    private readonly spaces: SpacesAccessService,
  ) {}
  async resolve(
    actorId: string,
    spaceId: string,
    session?: ClientSession,
  ): Promise<BudgetContext> {
    await this.spaces.requireMember(spaceId, actorId, session);
    return spaceBudget(spaceId);
  }
  async account(budget: BudgetContext, id: string, session?: ClientSession) {
    const account = await this.accounts
      .findOne({ _id: id, ...budgetFilter(budget) })
      .session(session ?? null);
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }
}
