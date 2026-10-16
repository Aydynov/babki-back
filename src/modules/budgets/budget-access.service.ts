import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
  BudgetContext,
  budgetFilter,
  groupBudget,
} from 'src/common/budget/budget-context';
import { personalBudget } from 'src/common/utils/personal-budget.util';
import { Account } from '../accounts/schemas/accounts.schema';
import { GroupsAccessService } from '../groups/groups-access.service';

@Injectable()
export class BudgetAccessService {
  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
    private readonly groups: GroupsAccessService,
  ) {}
  async resolve(
    actorId: string,
    groupId?: string,
    session?: ClientSession,
  ): Promise<BudgetContext> {
    if (groupId) {
      await this.groups.requireMember(groupId, actorId, session);
      return groupBudget(groupId);
    }
    return personalBudget(actorId);
  }
  async account(budget: BudgetContext, id: string, session?: ClientSession) {
    const account = await this.accounts
      .findOne({ _id: id, ...budgetFilter(budget) })
      .session(session ?? null);
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }
}
