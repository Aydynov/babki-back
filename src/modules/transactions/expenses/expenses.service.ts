import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasValidMoneyPrecision } from 'src/common/money/money';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { AccountsSnapshotsService } from 'src/modules/accounts-snapshots/accounts-snapshots.service';
import { Account } from 'src/modules/accounts/schemas/accounts.schema';
import {
  ExpenseCategory,
  ExpenseCategoryDocument,
} from 'src/modules/expense-categories/schemas/expense-category.schema';
import { lockBudgetExpenseCategory } from '../../expense-categories/expense-category-lock';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  FinancialChanges,
  FinancialTransaction,
  TransactionsService,
} from '../transactions/transactions.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { Expense, ExpenseDocument } from '../schemas/expense.schema';
import { TransactionOrigin } from '../schemas/transaction.schema';

type ExpenseCommand = CreateExpenseDto & { participantId?: string };

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(ExpenseCategory.name)
    private readonly expenseCategoryModel: Model<ExpenseCategoryDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  create(
    userId: string,
    dto: CreateExpenseDto,
    session?: ClientSession,
    origin?: TransactionOrigin,
  ) {
    const budget = personalBudget(userId);
    return this.transactionsService.runForBudget(
      budget,
      userId,
      async (activeSession) =>
        personalResponse(
          await this.createForBudget(
            budget,
            userId,
            dto,
            activeSession,
            origin,
          ),
        ),
      session,
    );
  }

  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: ExpenseCommand,
    session: ClientSession,
    origin?: TransactionOrigin,
    existingAccount?: Account & { _id: Types.ObjectId },
  ) {
    const date = new Date(dto.transactionDate);
    const account =
      existingAccount ??
      (await this.transactionsService.accountForCreate(
        budget,
        dto.accountId,
        date,
        session,
      ));
    this.transactionsService.validateMoneyForBudget(budget, account, dto);
    await this.transactionsService.lockAccountsForBudget(
      budget,
      [account._id.toString()],
      session,
    );
    const category = await lockBudgetExpenseCategory(
      this.expenseCategoryModel,
      budget,
      dto.categoryId,
      session,
    );
    const snapshot = await this.snapshotsService.prepareForBudget(
      account,
      date,
      session,
    );
    if (!snapshot) throw new NotFoundException('Snapshot not found.');
    const [expense] = await this.expenseModel.create(
      [
        {
          ...budgetFilter(budget),
          createdBy: new Types.ObjectId(actorId),
          participantId: new Types.ObjectId(
            budget.ownerType === 'user'
              ? budget.ownerId
              : (dto.participantId ?? actorId),
          ),
          accountId: account._id,
          snapshotId: snapshot._id,
          category: category._id,
          amount: dto.amount,
          transactionDate: date,
          description: dto.description,
          merchant: dto.merchant,
          items: dto.items ?? [],
          currency: account.currency,
          ...(budget.ownerType === 'user' ? { origin } : {}),
        },
      ],
      { session },
    );
    await this.snapshotsService.applyForBudget(
      account,
      date,
      -dto.amount,
      session,
    );
    return budget.ownerType === 'user'
      ? (await expense.populate('category')).toObject()
      : expense.toObject();
  }

  async findAll(userId: string, query: ListExpensesQueryDto) {
    const budget = await this.transactionsService.ensureUserExists(userId);
    const result = await this.transactionsService.findAllForBudget(
      budget,
      query,
      undefined,
      this.expenseModel,
      true,
    );
    return { ...result, items: result.items.map(personalResponse) };
  }

  countByFilters(
    userId: string,
    query: Omit<ListExpensesQueryDto, keyof PaginationQueryDto>,
  ) {
    return this.expenseModel.countDocuments(
      this.transactionsService.buildFilter(new Types.ObjectId(userId), query),
    );
  }

  async countHistoryByFilters(
    userId: string,
    query: Omit<ListExpensesQueryDto, keyof PaginationQueryDto>,
    session?: ClientSession,
  ) {
    const { deletedAt: _deletedAt, ...filter } =
      this.transactionsService.buildFilter(new Types.ObjectId(userId), query);
    const lookup = this.expenseModel.countDocuments(filter);
    return session && typeof lookup.session === 'function'
      ? lookup.session(session)
      : lookup;
  }

  async findOne(userId: string, expenseId: string, session?: ClientSession) {
    await this.transactionsService.ensureUserExists(userId, session);
    const row = await this.transactionsService.findOneForBudget(
      personalBudget(userId),
      expenseId,
      undefined,
      session,
      this.expenseModel,
      true,
    );
    return personalResponse(row);
  }

  findRevenue(userId: string, query: ListExpensesQueryDto) {
    return this.transactionsService.findRevenue(
      userId,
      query,
      this.expenseModel,
    );
  }

  async update(userId: string, expenseId: string, dto: UpdateExpenseDto) {
    const budget = personalBudget(userId);
    return this.transactionsService.runForBudget(
      budget,
      userId,
      async (session) => {
        await this.transactionsService.ensureUserExists(userId, session);
        const expense = await this.transactionsService.findOneForBudget(
          budget,
          expenseId,
          undefined,
          session,
          this.expenseModel,
          true,
        );
        if (
          dto.amount !== undefined &&
          (!expense.currency ||
            !hasValidMoneyPrecision(dto.amount, expense.currency))
        )
          throw new BadRequestException('Amount exceeds currency precision.');
        const category = dto.categoryId
          ? await this.categoryForBudget(budget, dto.categoryId, session)
          : undefined;
        const changes: FinancialChanges = Object.fromEntries(
          Object.entries({
            amount: dto.amount,
            description: dto.description,
            merchant: dto.merchant,
            items: dto.items,
            category: category?._id,
          }).filter(([, value]) => value !== undefined),
        );
        return personalResponse(
          await this.updateForBudget(budget, expense, changes, session),
        );
      },
    );
  }

  updateForBudget(
    budget: BudgetContext,
    expense: FinancialTransaction,
    changes: FinancialChanges,
    session: ClientSession,
    account?: Account & { _id: Types.ObjectId },
  ) {
    return this.transactionsService.updateForBudget(
      budget,
      expense,
      changes,
      session,
      this.expenseModel,
      budget.ownerType === 'user',
      account,
    );
  }

  categoryForBudget(
    budget: BudgetContext,
    categoryId: string,
    session: ClientSession,
  ) {
    return lockBudgetExpenseCategory(
      this.expenseCategoryModel,
      budget,
      categoryId,
      session,
    );
  }

  async requireCategoryForBudget(budget: BudgetContext, categoryId: string) {
    if (
      !(await this.expenseCategoryModel.exists({
        _id: categoryId,
        ...budgetFilter(budget),
      }))
    )
      throw new NotFoundException('Category not found');
  }
}
