import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import { Account, AccountsSchema } from '../accounts/schemas/accounts.schema';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from '../expense-categories/schemas/expense-category.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ExpensesController } from './expenses/expenses.controller';
import { ExpensesService } from './expenses/expenses.service';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { IncomesController } from './incomes/incomes.controller';
import { IncomesService } from './incomes/incomes.service';
import { Income, IncomeSchema } from './schemas/income.schema';
import { Transfer, TransferSchema } from './schemas/transfer.schema';
import { TransfersController } from './transfers/transfers.controller';
import { TransfersService } from './transfers/transfers.service';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';

@Module({
  imports: [
    AccountsSnapshotsModule,
    MongooseModule.forFeature([
      { name: Account.name, schema: AccountsSchema },
      { name: User.name, schema: UserSchema },
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      {
        name: Transaction.name,
        schema: TransactionSchema,
        discriminators: [
          { name: Expense.name, schema: ExpenseSchema, value: 'expense' },
          { name: Income.name, schema: IncomeSchema, value: 'income' },
          { name: Transfer.name, schema: TransferSchema, value: 'transfer' },
        ],
      },
    ]),
  ],
  controllers: [
    TransactionsController,
    ExpensesController,
    IncomesController,
    TransfersController,
  ],
  providers: [
    TransactionsService,
    ExpensesService,
    IncomesService,
    TransfersService,
  ],
  exports: [
    TransactionsService,
    ExpensesService,
    IncomesService,
    TransfersService,
    MongooseModule,
  ],
})
export class TransactionsModule {}
