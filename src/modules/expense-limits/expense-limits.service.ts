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
import { endOfDay, endOfMonth, startOfDay } from 'date-fns';
import { startOfMonth } from 'date-fns/startOfMonth';
import { Connection, Model, Types } from 'mongoose';
import { lockPersonalExpenseCategory } from '../expense-categories/expense-category-lock';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from '../expense-categories/schemas/expense-category.schema';
import { ExpenseCategoriesService } from '../expense-categories/expense-categories.service';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { CreateExpenseLimitDto } from './dto/create.dto';
import { FindExpenseLimitQueryDto } from './dto/find-query.dto';
import { FindExpenseLimitRevenueQueryDto } from './dto/find-revenue-query.dto';
import { UpdateExpenseLimitDto } from './dto/update.dto';
import {
  ExpenseLimit,
  ExpenseLimitDocument,
} from './schemas/expense-limit.schema';

type FilterParams = {
  userId: string;
  limitId?: string;
  categoryId?: string;
  startDate?: string;
  endDate?: string;
  periodDate?: string;
};
type FilterResult = {
  _id?: string;
  userId: Types.ObjectId;
  ownerType: 'user';
  ownerId: Types.ObjectId;
  category?: Types.ObjectId;
  startDate?: { $lte: Date } | Date;
  endDate?: { $gte: Date } | Date;
};

@Injectable()
export class ExpenseLimitsService {
  constructor(
    @InjectModel(ExpenseLimit.name)
    private readonly expenseLimitModel: Model<ExpenseLimitDocument>,
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategoryDocument>,
    private readonly expensesService: ExpensesService,
    private readonly expenseCategoriesService: ExpenseCategoriesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(userId: string, createExpenseLimitDto: CreateExpenseLimitDto) {
    const startDate = createExpenseLimitDto.startDate
      ? startOfDay(createExpenseLimitDto.startDate)
      : startOfMonth(new Date());
    const endDate = endOfDay(
      createExpenseLimitDto.endDate ?? endOfMonth(new Date()),
    );
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const foundCategory = await lockPersonalExpenseCategory(
          this.expenseCategoryModel,
          userId,
          createExpenseLimitDto.categoryId,
          session,
        );
        const overlapping = await this.expenseLimitModel
          .exists({
            ...personalBudget(new Types.ObjectId(userId)),
            category: foundCategory._id,
            startDate: { $lte: endDate },
            endDate: { $gte: startDate },
          })
          .session(session);
        if (overlapping) {
          throw new ConflictException('Expense limit period overlaps.');
        }
        const [created] = await this.expenseLimitModel.create(
          [
            {
              ...createExpenseLimitDto,
              startDate,
              endDate,
              category: foundCategory._id,
              ...personalBudget(new Types.ObjectId(userId)),
            },
          ],
          { session },
        );
        const limit = await created.populate('category');
        return this.buildResponse(limit);
      });
    } finally {
      await session.endSession();
    }
  }

  async findAll(userId: string, queryDto: FindExpenseLimitQueryDto) {
    const limits = await this.expenseLimitModel
      .find(
        this.buildFilter({
          userId,
          categoryId: queryDto.categoryId,
          periodDate: queryDto.periodDate,
        }),
      )
      .sort({ startDate: -1, endDate: -1, createdAt: -1 })
      .populate('category')
      .lean()
      .exec();

    return Promise.all(limits.map((limit) => this.buildResponse(limit)));
  }

  async findOne(userId: string, limitId: string) {
    const limit = await this.expenseLimitModel
      .findOne(this.buildFilter({ limitId, userId }))
      .populate('category')
      .lean()
      .exec();

    if (!limit) {
      throw new NotFoundException(
        `Expense limit ${limitId} for user ${userId} not found.`,
      );
    }

    return this.buildResponse(limit);
  }

  async update(
    userId: string,
    limitId: string,
    updateExpenseLimitDto: UpdateExpenseLimitDto,
  ) {
    const limit = await this.expenseLimitModel
      .findOneAndUpdate(
        { _id: limitId, ...personalBudget(new Types.ObjectId(userId)) },
        updateExpenseLimitDto,
        {
          returnDocument: 'after',
          runValidators: true,
        },
      )
      .populate('category')
      .lean()
      .exec();

    if (!limit) {
      throw new NotFoundException(
        `Expense limit ${limitId} for user ${userId} not found.`,
      );
    }

    return this.buildResponse(limit);
  }

  async deleteEntity(userId: string, limitId: string) {
    const result = await this.expenseLimitModel
      .deleteOne({
        _id: limitId,
        ...personalBudget(new Types.ObjectId(userId)),
      })
      .lean()
      .exec();
    if (!result.deletedCount)
      throw new NotFoundException('Expense limit not found');
  }

  private async buildResponse(limit: ExpenseLimitDocument) {
    const expenseRevenue = await this.findRevenue(limit.userId.toString(), {
      startDate: limit.startDate.toString(),
      endDate: limit.endDate.toString(),
      categoryId: limit.category._id.toString(),
    });

    return {
      ...personalResponse(limit),
      rest: limit.total - expenseRevenue,
    };
  }

  private buildFilter(params: FilterParams) {
    const filter: FilterResult = {
      ...personalBudget(new Types.ObjectId(params.userId)),
    };
    if (params.limitId) {
      filter._id = params.limitId;
    }
    if (params.categoryId) {
      filter.category = new Types.ObjectId(params.categoryId);
    }
    if (params.periodDate) {
      const date = new Date(params.periodDate);
      filter.startDate = { $lte: date };
      filter.endDate = { $gte: date };
    }
    if (params.startDate && params.endDate) {
      filter.startDate = new Date(params.startDate);
      filter.endDate = endOfDay(new Date(params.endDate));
    }

    return filter;
  }

  private async findRevenue(
    userId: string,
    queryDto: FindExpenseLimitRevenueQueryDto,
  ) {
    const revenue = await this.expensesService.findRevenue(userId, {
      categoryId: queryDto.categoryId,
      transactionType: 'expense',
      fromDate: queryDto.startDate,
      toDate: queryDto.endDate,
    });
    return revenue.totalRevenue;
  }
}
