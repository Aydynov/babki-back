import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DebtTransaction,
  DebtTransactionSchema,
} from '../debt-transactions/schemas/debt-transaction.schema';
import { TransactionsModule } from '../transactions/transactions.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DebtsService } from './debts.service';
import { Debt, DebtSchema } from './schemas/debt.schema';
@Module({
  imports: [
    TransactionsModule,
    MongooseModule.forFeature([
      { name: Debt.name, schema: DebtSchema },
      { name: User.name, schema: UserSchema },
      { name: DebtTransaction.name, schema: DebtTransactionSchema },
    ]),
  ],
  controllers: [],
  providers: [DebtsService],
  exports: [DebtsService, MongooseModule],
})
export class DebtsModule {}
