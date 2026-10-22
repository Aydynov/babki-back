import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Debt, DebtSchema } from '../debts/schemas/debt.schema';
import { DebtTransactionsService } from './debt-transactions.service';
import {
  DebtTransaction,
  DebtTransactionSchema,
} from './schemas/debt-transaction.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DebtTransaction.name, schema: DebtTransactionSchema },
      { name: Debt.name, schema: DebtSchema },
    ]),
  ],
  controllers: [],
  providers: [DebtTransactionsService],
  exports: [DebtTransactionsService, MongooseModule],
})
export class DebtTransactionsModule {}
