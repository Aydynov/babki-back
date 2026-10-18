import { Module } from '@nestjs/common';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { AccountsLookupModule } from './accounts-lookup.module';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';

@Module({
  imports: [
    UsersModule,
    BudgetsModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    AccountsLookupModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsLookupModule, AccountsService],
})
export class AccountsModule {}
