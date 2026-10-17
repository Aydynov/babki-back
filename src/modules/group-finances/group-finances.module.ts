import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReportsModule } from '../reports/reports.module';
import { GroupsModule } from '../groups/groups.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';
import { ExpenseLimitsModule } from '../expense-limits/expense-limits.module';
import {
  AccountSnapshot,
  AccountsSnapshotsSchema,
} from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from '../expense-categories/schemas/expense-category.schema';
import {
  ExpenseLimit,
  ExpenseLimitSchema,
} from '../expense-limits/schemas/expense-limit.schema';
import { GroupTransfersService } from './group-transfers.service';
import { GroupWalletService } from './group-wallet.service';
import { GroupTransactionsService } from './group-transactions.service';
import { GroupSettingsService } from './group-settings.service';
import { GroupReportsService } from './group-reports.service';
import { GroupFinancesController } from './group-finances.controller';
import { GroupFinancialActorsService } from './group-financial-actors.service';
import { PlansModule } from '../plans/plans.module';
import { GroupPlansController } from './group-plans.controller';
import { GroupPlansService } from './group-plans.service';
import { DebtsModule } from '../debts/debts.module';
import { DebtTransactionsModule } from '../debt-transactions/debt-transactions.module';
import { GroupDebtsController } from './group-debts.controller';
import { GroupDebtsService } from './group-debts.service';
@Module({
  imports: [
    DebtsModule,
    DebtTransactionsModule,
    PlansModule,
    ReportsModule,
    AccountsModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    GroupsModule,
    BudgetsModule,
    ExpenseCategoriesModule,
    ExpenseLimitsModule,
    MongooseModule.forFeature([
      { name: AccountSnapshot.name, schema: AccountsSnapshotsSchema },
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: ExpenseLimit.name, schema: ExpenseLimitSchema },
    ]),
  ],
  controllers: [
    GroupFinancesController,
    GroupPlansController,
    GroupDebtsController,
  ],
  providers: [
    GroupDebtsService,
    GroupPlansService,
    GroupFinancialActorsService,
    GroupTransfersService,
    GroupWalletService,
    GroupTransactionsService,
    GroupSettingsService,
    GroupReportsService,
  ],
})
export class GroupFinancesModule {}
