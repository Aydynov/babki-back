import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsLookupService } from './accounts-lookup.service';
import { Account, AccountsSchema } from './schemas/accounts.schema';
import { Balance, BalanceSchema } from './schemas/balances.schema';
import { Saving, SavingsSchema } from './schemas/savings.schema';

@Module({
  imports: [
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
  providers: [AccountsLookupService],
  exports: [AccountsLookupService, MongooseModule],
})
export class AccountsLookupModule {}
