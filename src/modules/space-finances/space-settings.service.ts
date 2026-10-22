import { BadRequestException, Injectable } from '@nestjs/common';
import { spaceBudget } from 'src/common/budget/budget-context';
import { BudgetAccessService } from '../budgets/budget-access.service';
import { BudgetWriteService } from '../budgets/budget-write.service';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { ExpenseLimitsService } from '../expense-limits/expense-limits.service';
import {
  CreateSpaceCategoryDto,
  CreateSpaceLimitDto,
  SpaceLimitsQueryDto,
  UpdateSpaceCategoryDto,
  UpdateSpaceLimitDto,
} from './dto/space-finances.dto';
@Injectable()
export class SpaceSettingsService {
  constructor(
    private readonly categories: ExpenseCategoriesService,
    private readonly limits: ExpenseLimitsService,
    private readonly access: BudgetAccessService,
    private readonly write: BudgetWriteService,
  ) {}
  async listCategories(spaceId: string, actor: string) {
    await this.access.resolve(actor, spaceId);
    return this.categories.findAllForBudget(spaceBudget(spaceId));
  }
  async getCategory(spaceId: string, actor: string, id: string) {
    await this.access.resolve(actor, spaceId);
    return this.categories.findOneForBudget(spaceBudget(spaceId), id);
  }
  saveCategory(
    spaceId: string,
    actor: string,
    dto: CreateSpaceCategoryDto | UpdateSpaceCategoryDto,
    id?: string,
  ) {
    this.requireChanges(dto);
    const budget = spaceBudget(spaceId);
    return this.write.run(
      budget,
      actor,
      (session) =>
        id
          ? this.categories.updateForBudget(budget, id, dto, session)
          : this.categories.createForBudget(
              budget,
              dto as CreateSpaceCategoryDto,
              session,
            ),
      'manageCategories',
    );
  }
  async removeCategory(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
    await this.write.run(
      budget,
      actor,
      (session) => this.categories.removeForBudget(budget, id, session),
      'manageCategories',
    );
  }
  async listLimits(spaceId: string, actor: string, query: SpaceLimitsQueryDto) {
    await this.access.resolve(actor, spaceId);
    const budget = spaceBudget(spaceId);
    if (query.categoryId)
      await this.categories.findOneForBudget(budget, query.categoryId);
    return this.limits.findAllForBudget(budget, query);
  }
  async getLimit(spaceId: string, actor: string, id: string) {
    await this.access.resolve(actor, spaceId);
    return this.limits.findOneForBudget(spaceBudget(spaceId), id);
  }
  saveLimit(
    spaceId: string,
    actor: string,
    dto: CreateSpaceLimitDto | UpdateSpaceLimitDto,
    id?: string,
  ) {
    this.requireChanges(dto);
    const budget = spaceBudget(spaceId);
    return this.write.run(
      budget,
      actor,
      (session) =>
        id
          ? this.limits.updateForBudget(budget, id, dto, session)
          : this.limits.createForBudget(
              budget,
              dto as CreateSpaceLimitDto,
              session,
            ),
      'manageLimits',
    );
  }
  async removeLimit(spaceId: string, actor: string, id: string) {
    const budget = spaceBudget(spaceId);
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
