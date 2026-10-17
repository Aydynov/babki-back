import { Module } from '@nestjs/common';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import { AccountsModule } from '../accounts/accounts.module';
import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    AccountsModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    ExpenseCategoriesModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
