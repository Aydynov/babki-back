import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsModule } from '../accounts/accounts.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { GroupsModule } from '../groups/groups.module';
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
import { BudgetAccessService } from './budget-access.service';
import { GroupFinanceWriteService } from './group-finance-write.service';
import { GroupWalletService } from './group-wallet.service';
import { GroupTransactionsService } from './group-transactions.service';
import { GroupSettingsService } from './group-settings.service';
import { GroupReportsService } from './group-reports.service';
import { GroupFinancesController } from './group-finances.controller';
@Module({
  imports: [
    AccountsModule,
    TransactionsModule,
    GroupsModule,
    MongooseModule.forFeature([
      { name: AccountSnapshot.name, schema: AccountsSnapshotsSchema },
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: ExpenseLimit.name, schema: ExpenseLimitSchema },
    ]),
  ],
  controllers: [GroupFinancesController],
  providers: [
    BudgetAccessService,
    GroupFinanceWriteService,
    GroupWalletService,
    GroupTransactionsService,
    GroupSettingsService,
    GroupReportsService,
  ],
})
export class GroupFinancesModule {}
