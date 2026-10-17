import { Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { groupBudget } from 'src/common/budget/budget-context';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { Account } from '../accounts/schemas/accounts.schema';
import { AccountsSnapshotsService } from '../accounts-snapshots/accounts-snapshots.service';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { CreateGroupAccountDto } from './dto/group-finances.dto';

@Injectable()
export class GroupWalletService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly snapshots: AccountsSnapshotsService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
  ) {}
  create(groupId: string, actor: string, dto: CreateGroupAccountDto) {
    const budget = groupBudget(groupId);
    return this.write.run(
      budget,
      actor,
      (session) => this.accounts.createForBudget(budget, dto, session),
      'manageAccounts',
    );
  }
  async list(groupId: string, actor: string) {
    return this.accounts.listForBudget(
      await this.access.resolve(actor, groupId),
    );
  }
  async get(groupId: string, actor: string, id: string) {
    return this.accounts.getForBudget(
      await this.access.resolve(actor, groupId),
      id,
    );
  }
  async remove(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    await this.write.run(
      budget,
      actor,
      (session) => this.accounts.removeForBudget(budget, id, session),
      'manageAccounts',
    );
  }
  balance(
    account: Account & { _id: Types.ObjectId },
    date: Date,
    session?: ClientSession,
  ) {
    return this.snapshots.balanceForBudget(account, date, session);
  }
}
