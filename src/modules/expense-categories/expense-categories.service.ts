import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { ExpenseLimit } from '../expense-limits/schemas/expense-limit.schema';
import { Plan } from '../plans/schemas/plan.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { lockBudgetExpenseCategory } from './expense-category-lock';
import { ExpenseCategory } from './schemas/expense-category.schema';
@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategory>,
    @InjectModel(ExpenseLimit.name)
    private readonly expenseLimitModel: Model<ExpenseLimit>,
    @InjectModel(Plan.name)
    private readonly planModel: Model<Plan>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<Transaction>,
  ) {}
  async createForBudget(
    budget: BudgetContext,
    dto: CreateExpenseCategoryDto,
    session?: ClientSession,
  ) {
    try {
      await this.checkDuplicateName(budget, dto.name, undefined, session);
      const [category] = await this.expenseCategoryModel.create(
        [{ ...dto, ...budgetFilter(budget) }],
        { session },
      );
      return category.toObject();
    } catch (error) {
      this.handleDuplicateName(error);
    }
  }
  findAllForBudget(budget: BudgetContext) {
    return this.expenseCategoryModel
      .find({
        ...budgetFilter(budget),
        ...{},
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }
  async findOneForBudget(
    budget: BudgetContext,
    categoryId: string,
    session?: ClientSession,
  ) {
    const category = await this.expenseCategoryModel
      .findOne({ _id: new Types.ObjectId(categoryId), ...budgetFilter(budget) })
      .session(session ?? null)
      .lean()
      .exec();
    if (!category) throw this.notFound(budget, categoryId);
    return category;
  }
  async updateForBudget(
    budget: BudgetContext,
    categoryId: string,
    dto: UpdateExpenseCategoryDto,
    session: ClientSession,
  ) {
    try {
      await lockBudgetExpenseCategory(
        this.expenseCategoryModel,
        budget,
        categoryId,
        session,
        { allowArchived: true },
      );
      await this.checkDuplicateName(budget, dto.name, categoryId, session);
      const category = await this.expenseCategoryModel
        .findOneAndUpdate(
          { _id: categoryId, ...budgetFilter(budget) },
          { $set: dto },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean()
        .exec();
      if (!category) throw this.notFound(budget, categoryId);
      return category;
    } catch (error) {
      this.handleDuplicateName(error);
    }
  }
  async removeForBudget(
    budget: BudgetContext,
    categoryId: string,
    session: ClientSession,
  ) {
    const category = await lockBudgetExpenseCategory(
      this.expenseCategoryModel,
      budget,
      categoryId,
      session,
      { allowArchived: true },
    );
    const dependencyFilter = {
      ...budgetFilter(budget),
      category: category._id,
    };
    // Deleted expenses still belong to financial history.
    const linkedExpense = await this.transactionModel
      .exists({ ...dependencyFilter, type: 'expense' })
      .session(session);
    const linkedLimit = await this.expenseLimitModel
      .exists(dependencyFilter)
      .session(session);
    const linkedPlan = await this.planModel
      .exists({
        ...budgetFilter(budget),
        categoryId: { $in: [category._id, category._id.toString()] },
      })
      .session(session);
    if (linkedExpense || linkedLimit || linkedPlan)
      throw new ConflictException('Category is in use');
    const result = await this.expenseCategoryModel.deleteOne(
      { _id: category._id, ...budgetFilter(budget) },
      { session },
    );
    if (!result.deletedCount) throw this.notFound(budget, categoryId);
  }
  private async checkDuplicateName(
    budget: BudgetContext,
    name?: string,
    id?: string,
    session?: ClientSession,
  ) {
    // Space HTTP has always returned a specific conflict before the insert/update.
    if (
      name &&
      (await this.expenseCategoryModel
        .exists({
          ...budgetFilter(budget),
          name,
          ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}),
        })
        .session(session ?? null))
    )
      throw new ConflictException('Category name already exists');
  }
  private notFound(_budget: BudgetContext, _categoryId: string) {
    return new NotFoundException('Category not found');
  }
  private handleDuplicateName(error: unknown): never {
    if (
      (
        error as {
          code?: number;
        }
      ).code === 11000
    )
      throw new ConflictException(
        'An expense category with this name already exists.',
      );
    throw error;
  }
}
