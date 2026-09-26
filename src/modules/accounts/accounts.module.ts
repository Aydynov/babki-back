import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsSnapshotsModule } from '../accounts-snapshots/accounts-snapshots.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { Account, AccountsSchema } from './schemas/accounts.schema';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { Balance, BalanceSchema } from './schemas/balances.schema';
import { Saving, SavingsSchema } from './schemas/savings.schema';

@Module({
  imports: [
    UsersModule,
    AccountsSnapshotsModule,
    TransactionsModule,
    MongooseModule.forFeature([
      {
        name: Account.name,
        schema: AccountsSchema,
        discriminators: [
          { name: Saving.name, schema: SavingsSchema, value: 'saving' },
          { name: Balance.name, schema: BalanceSchema, value: 'balance' },
        ],
      },
    ]),
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [MongooseModule, AccountsService],
})
export class AccountsModule {}
