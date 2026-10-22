import { Injectable, NotFoundException } from '@nestjs/common';
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
import { Expense, ExpenseDocument } from '../schemas/expense.schema';
import { TransactionOrigin } from '../schemas/transaction.schema';
import {
  FinancialChanges,
  FinancialTransaction,
  TransactionsService,
} from '../transactions/transactions.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
type ExpenseCommand = CreateExpenseDto & {
  participantId?: string;
};
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
  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: ExpenseCommand,
    session: ClientSession,
    origin?: TransactionOrigin,
    existingAccount?: Account & {
      _id: Types.ObjectId;
    },
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
          participantId: new Types.ObjectId(dto.participantId ?? actorId),
          accountId: account._id,
          snapshotId: snapshot._id,
          category: category._id,
          amount: dto.amount,
          transactionDate: date,
          description: dto.description,
          merchant: dto.merchant,
          items: dto.items ?? [],
          currency: account.currency,
          ...(origin ? { origin } : {}),
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
    return expense.toObject();
  }
  updateForBudget(
    budget: BudgetContext,
    expense: FinancialTransaction,
    changes: FinancialChanges,
    session: ClientSession,
    account?: Account & {
      _id: Types.ObjectId;
    },
  ) {
    return this.transactionsService.updateForBudget(
      budget,
      expense,
      changes,
      session,
      this.expenseModel,
      false,
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
