import { BadRequestException, Injectable } from '@nestjs/common';
import { groupBudget } from 'src/common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { ExpenseLimitsService } from '../expense-limits/expense-limits.service';
import {
  CreateGroupCategoryDto,
  UpdateGroupCategoryDto,
  CreateGroupLimitDto,
  UpdateGroupLimitDto,
  GroupLimitsQueryDto,
} from './dto/group-finances.dto';

@Injectable()
export class GroupSettingsService {
  constructor(
    private readonly categories: ExpenseCategoriesService,
    private readonly limits: ExpenseLimitsService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
  ) {}

  async listCategories(groupId: string, actor: string) {
    await this.access.resolve(actor, groupId);
    return this.categories.findAllForBudget(groupBudget(groupId));
  }

  async getCategory(groupId: string, actor: string, id: string) {
    await this.access.resolve(actor, groupId);
    return this.categories.findOneForBudget(groupBudget(groupId), id);
  }

  saveCategory(
    groupId: string,
    actor: string,
    dto: CreateGroupCategoryDto | UpdateGroupCategoryDto,
    id?: string,
  ) {
    this.requireChanges(dto);
    const budget = groupBudget(groupId);
    return this.write.run(
      budget,
      actor,
      (session) =>
        id
          ? this.categories.updateForBudget(budget, id, dto, session)
          : this.categories.createForBudget(
              budget,
              dto as CreateGroupCategoryDto,
              session,
            ),
      'manageCategories',
    );
  }

  async removeCategory(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    await this.write.run(
      budget,
      actor,
      (session) => this.categories.removeForBudget(budget, id, session),
      'manageCategories',
    );
  }

  async listLimits(groupId: string, actor: string, query: GroupLimitsQueryDto) {
    await this.access.resolve(actor, groupId);
    const budget = groupBudget(groupId);
    if (query.categoryId)
      await this.categories.findOneForBudget(budget, query.categoryId);
    return this.limits.findAllForBudget(budget, query);
  }

  async getLimit(groupId: string, actor: string, id: string) {
    await this.access.resolve(actor, groupId);
    return this.limits.findOneForBudget(groupBudget(groupId), id);
  }

  saveLimit(
    groupId: string,
    actor: string,
    dto: CreateGroupLimitDto | UpdateGroupLimitDto,
    id?: string,
  ) {
    this.requireChanges(dto);
    const budget = groupBudget(groupId);
    return this.write.run(
      budget,
      actor,
      (session) =>
        id
          ? this.limits.updateForBudget(budget, id, dto, session)
          : this.limits.createForBudget(
              budget,
              dto as CreateGroupLimitDto,
              session,
            ),
      'manageLimits',
    );
  }

  async removeLimit(groupId: string, actor: string, id: string) {
    const budget = groupBudget(groupId);
    await this.write.run(
      budget,
      actor,
      (session) => this.limits.removeForBudget(budget, id, session),
      'manageLimits',
    );
  }

  private requireChanges(dto: object) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Empty update');
  }
}
