import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Account } from '../accounts/schemas/accounts.schema';
import { GroupsAccessService } from '../groups/groups-access.service';
export type BudgetContext = {
  ownerType: 'user' | 'group';
  ownerId: Types.ObjectId;
};
export const groupBudget = (id: string): BudgetContext => ({
  ownerType: 'group',
  ownerId: new Types.ObjectId(id),
});
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
    return { ownerType: 'user', ownerId: new Types.ObjectId(actorId) };
  }
  async account(budget: BudgetContext, id: string, session?: ClientSession) {
    const account = await this.accounts
      .findOne({ _id: id, ...budget })
      .session(session ?? null);
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }
}
