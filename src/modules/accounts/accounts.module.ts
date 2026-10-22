import { Module } from '@nestjs/common';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { AccountsLookupModule } from './accounts-lookup.module';
import { AccountsService } from './accounts/accounts.service';
@Module({
  imports: [
    UsersModule,
    BudgetsModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    AccountsLookupModule,
  ],
  controllers: [],
  providers: [AccountsService],
  exports: [AccountsLookupModule, AccountsService],
})
export class AccountsModule {}
