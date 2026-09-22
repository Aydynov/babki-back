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
import { Connection, Model, Types } from 'mongoose';
import {
  ExpenseLimit,
  ExpenseLimitDocument,
} from '../expense-limits/schemas/expense-limit.schema';
import { Plan, PlanDocument } from '../plans/schemas/plan.schema';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from './schemas/expense-category.schema';
import { lockPersonalExpenseCategory } from './expense-category-lock';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategoryDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(ExpenseLimit.name)
    private readonly expenseLimitModel: Model<ExpenseLimitDocument>,
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
    private readonly expensesService: ExpensesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    userId: string,
    createExpenseCategoryDto: CreateExpenseCategoryDto,
  ) {
    await this.ensureUserExists(userId);

    try {
      const category = await this.expenseCategoryModel.create({
        ...createExpenseCategoryDto,
        ...personalBudget(new Types.ObjectId(userId)),
      });

      return personalResponse(category.toObject());
    } catch (error) {
      this.handleDuplicateName(error);
    }
  }

  async findAll(userId: string) {
    await this.ensureUserExists(userId);

    const categories = await this.expenseCategoryModel
      .find({
        ...personalBudget(new Types.ObjectId(userId)),
        isArchived: false,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return categories.map(personalResponse);
  }

  async findOne(userId: string, categoryId: string) {
    const category = await this.expenseCategoryModel
      .findOne({
        _id: new Types.ObjectId(categoryId),
        ...personalBudget(new Types.ObjectId(userId)),
      })
      .lean()
      .exec();

    if (!category) {
      throw new NotFoundException(
        `Expense category ${categoryId} for user ${userId} not found.`,
      );
    }

    return personalResponse(category);
  }

  async update(
    userId: string,
    categoryId: string,
    updateExpenseCategoryDto: UpdateExpenseCategoryDto,
  ) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        await lockPersonalExpenseCategory(
          this.expenseCategoryModel,
          userId,
          categoryId,
          session,
          { allowArchived: true },
        );
        const category = await this.expenseCategoryModel
          .findOneAndUpdate(
            {
              _id: categoryId,
              ...personalBudget(new Types.ObjectId(userId)),
            },
            { $set: updateExpenseCategoryDto },
            {
              returnDocument: 'after',
              runValidators: true,
              session,
            },
          )
          .lean()
          .exec();

        if (!category) {
          throw new NotFoundException(
            `Expense category ${categoryId} for user ${userId} not found.`,
          );
        }

        return personalResponse(category);
      });
    } catch (error) {
      this.handleDuplicateName(error);
    } finally {
      await session.endSession();
    }
  }

  async remove(userId: string, categoryId: string) {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const foundCategory = await lockPersonalExpenseCategory(
          this.expenseCategoryModel,
          userId,
          categoryId,
          session,
          { allowArchived: true },
        );
        const dependencyFilter = {
          ...personalBudget(new Types.ObjectId(userId)),
          category: foundCategory._id,
        };
        const linkedExpenses = await this.expensesService.countHistoryByFilters(
          userId,
          { categoryId },
          session,
        );
        const linkedLimit = await this.expenseLimitModel
          .exists(dependencyFilter)
          .session(session);
        const linkedPlan = await this.planModel
          .exists({
            categoryId: {
              $in: [foundCategory._id, foundCategory._id.toString()],
            },
          })
          .session(session);

        if (linkedExpenses || linkedLimit || linkedPlan) {
          throw new ConflictException(
            'Cannot delete an expense category linked to financial history.',
          );
        }

        const result = await this.expenseCategoryModel.deleteOne(
          {
            _id: foundCategory._id,
            ...personalBudget(new Types.ObjectId(userId)),
          },
          { session },
        );
        if (!result.deletedCount) {
          throw new NotFoundException(
            `Expense category ${categoryId} for user ${userId} not found.`,
          );
        }
      });
    } finally {
      await session.endSession();
    }
  }

  private handleDuplicateName(error: unknown): never {
    if ((error as { code?: number }).code === 11000) {
      throw new ConflictException(
        'An expense category with this name already exists.',
      );
    }

    throw error;
  }

  private async ensureUserExists(userId: string) {
    const exists = await this.userModel.exists({ _id: userId });

    if (!exists) {
      throw new NotFoundException(`User ${userId} not found.`);
    }
  }
}
