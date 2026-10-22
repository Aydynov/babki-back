import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountsSchema } from '../accounts/schemas/accounts.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { AccountsSnapshotsService } from './accounts-snapshots.service';
import {
  AccountSnapshot,
  AccountsSnapshotsSchema,
} from './schemas/accounts-snapshots.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccountSnapshot.name, schema: AccountsSnapshotsSchema },
      { name: Account.name, schema: AccountsSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [],
  providers: [AccountsSnapshotsService],
  exports: [MongooseModule, AccountsSnapshotsService],
})
export class AccountsSnapshotsModule {}
