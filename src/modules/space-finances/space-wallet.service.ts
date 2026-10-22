import { Injectable } from '@nestjs/common';
import { spaceBudget } from 'src/common/budget/budget-context';
import { AccountsService } from '../accounts/accounts/accounts.service';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import {
  CreateSpaceAccountDto,
  SpaceAccountsQueryDto,
} from './dto/space-finances.dto';
@Injectable()
export class SpaceWalletService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
  ) {}
  create(spaceId: string, actor: string, dto: CreateSpaceAccountDto) {
    const budget = spaceBudget(spaceId);
    return this.write.run(
      budget,
      actor,
      (session) => this.accounts.createForBudget(budget, dto, session),
      'manageAccounts',
    );
  }
  async list(spaceId: string, actor: string, query: SpaceAccountsQueryDto) {
    return this.accounts.listForBudget(
      await this.access.resolve(actor, spaceId),
      query,
    );
  }
  async get(spaceId: string, actor: string, id: string) {
    return this.accounts.getForBudget(
      await this.access.resolve(actor, spaceId),
      id,
    );
  }
  async remove(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    await this.write.run(
      budget,
      actor,
      (session) => this.accounts.removeForBudget(budget, id, session),
      'manageAccounts',
    );
  }
  rename(spaceId: string, actor: string, id: string, name: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(
      budget,
      actor,
      (session) => this.accounts.renameForBudget(budget, id, name, session),
      'manageAccounts',
    );
  }
  archive(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    return this.write.run(
      budget,
      actor,
      (session) => this.accounts.archiveForBudget(budget, id, session),
      'manageAccounts',
    );
  }
}
