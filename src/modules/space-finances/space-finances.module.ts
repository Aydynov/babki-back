import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import {
  AccountSnapshot,
  AccountsSnapshotsSchema,
} from '../accounts-snapshots/schemas/accounts-snapshots.schema';
import { AccountsModule } from '../accounts/accounts.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { DebtTransactionsModule } from '../debt-transactions/debt-transactions.module';
import { DebtsModule } from '../debts/debts.module';
import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from '../expense-categories/schemas/expense-category.schema';
import { ExpenseLimitsModule } from '../expense-limits/expense-limits.module';
import {
  ExpenseLimit,
  ExpenseLimitSchema,
} from '../expense-limits/schemas/expense-limit.schema';
import { PlansModule } from '../plans/plans.module';
import { ReportsModule } from '../reports/reports.module';
import { SpacesModule } from '../spaces/spaces.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { SpaceDebtsController } from './space-debts.controller';
import { SpaceDebtsService } from './space-debts.service';
import { SpaceFinancesController } from './space-finances.controller';
import { SpaceFinancialActorsService } from './space-financial-actors.service';
import { SpacePlansController } from './space-plans.controller';
import { SpacePlansService } from './space-plans.service';
import { SpaceReportsService } from './space-reports.service';
import { SpaceSettingsService } from './space-settings.service';
import { SpaceTransactionsService } from './space-transactions.service';
import { SpaceTransfersService } from './space-transfers.service';
import { SpaceWalletService } from './space-wallet.service';
@Module({
  imports: [
    DebtsModule,
    DebtTransactionsModule,
    PlansModule,
    ReportsModule,
    AccountsModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    SpacesModule,
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
    SpaceFinancesController,
    SpacePlansController,
    SpaceDebtsController,
  ],
  providers: [
    SpaceDebtsService,
    SpacePlansService,
    SpaceFinancialActorsService,
    SpaceTransfersService,
    SpaceWalletService,
    SpaceTransactionsService,
    SpaceSettingsService,
    SpaceReportsService,
  ],
})
export class SpaceFinancesModule {}
