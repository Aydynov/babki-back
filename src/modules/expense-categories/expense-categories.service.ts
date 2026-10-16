import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { ExpenseLimit } from '../expense-limits/schemas/expense-limit.schema';
import { Plan } from '../plans/schemas/plan.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { User } from '../users/schemas/user.schema';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { ExpenseCategory } from './schemas/expense-category.schema';
import { lockBudgetExpenseCategory } from './expense-category-lock';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategory>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ExpenseLimit.name)
    private readonly expenseLimitModel: Model<ExpenseLimit>,
    @InjectModel(Plan.name) private readonly planModel: Model<Plan>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<Transaction>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(userId: string, dto: CreateExpenseCategoryDto) {
    await this.ensureUserExists(userId);
    return personalResponse(
      await this.createForBudget(personalBudget(userId), dto),
    );
  }

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

  async findAll(userId: string) {
    await this.ensureUserExists(userId);
    return (await this.findAllForBudget(personalBudget(userId))).map(
      personalResponse,
    );
  }

  findAllForBudget(budget: BudgetContext) {
    return this.expenseCategoryModel
      .find({
        ...budgetFilter(budget),
        ...(budget.ownerType === 'user' ? { isArchived: false } : {}),
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findOne(userId: string, categoryId: string) {
    return personalResponse(
      await this.findOneForBudget(personalBudget(userId), categoryId),
    );
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

  async update(
    userId: string,
    categoryId: string,
    dto: UpdateExpenseCategoryDto,
  ) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () =>
        personalResponse(
          await this.updateForBudget(
            personalBudget(userId),
            categoryId,
            dto,
            session,
          ),
        ),
      );
    } finally {
      await session.endSession();
    }
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

  async remove(userId: string, categoryId: string) {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() =>
        this.removeForBudget(personalBudget(userId), categoryId, session),
      );
    } finally {
      await session.endSession();
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
    const linkedPlan =
      budget.ownerType === 'user'
        ? await this.planModel
            .exists({
              categoryId: { $in: [category._id, category._id.toString()] },
            })
            .session(session)
        : null;
    if (linkedExpense || linkedLimit || linkedPlan)
      throw new ConflictException(
        budget.ownerType === 'user'
          ? 'Cannot delete an expense category linked to financial history.'
          : 'Category is in use',
      );
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
    // Group HTTP has always returned a specific conflict before the insert/update.
    if (
      budget.ownerType === 'group' &&
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

  private notFound(budget: BudgetContext, categoryId: string) {
    return new NotFoundException(
      budget.ownerType === 'user'
        ? `Expense category ${categoryId} for user ${budget.ownerId.toString()} not found.`
        : 'Category not found',
    );
  }

  private handleDuplicateName(error: unknown): never {
    if ((error as { code?: number }).code === 11000)
      throw new ConflictException(
        'An expense category with this name already exists.',
      );
    throw error;
  }

  private async ensureUserExists(userId: string) {
    if (!(await this.userModel.exists({ _id: userId })))
      throw new NotFoundException(`User ${userId} not found.`);
  }
}
