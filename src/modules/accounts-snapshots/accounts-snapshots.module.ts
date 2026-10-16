import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Account, AccountsSchema } from '../accounts/schemas/accounts.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import {
  AccountSnapshot,
  AccountsSnapshotsSchema,
} from './schemas/accounts-snapshots.schema';
import { AccountsSnapshotsController } from './accounts-snapshots.controller';
import { AccountsSnapshotsService } from './accounts-snapshots.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccountSnapshot.name, schema: AccountsSnapshotsSchema },
      { name: Account.name, schema: AccountsSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [AccountsSnapshotsController],
  providers: [AccountsSnapshotsService],
  exports: [MongooseModule, AccountsSnapshotsService],
})
export class AccountsSnapshotsModule {}
