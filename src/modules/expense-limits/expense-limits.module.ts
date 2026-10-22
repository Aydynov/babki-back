import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from '../expense-categories/schemas/expense-category.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ExpenseLimitsService } from './expense-limits.service';
import {
  ExpenseLimit,
  ExpenseLimitSchema,
} from './schemas/expense-limit.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseLimit.name, schema: ExpenseLimitSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: User.name, schema: UserSchema },
      {
        name: ExpenseCategory.name,
        schema: ExpenseCategorySchema,
      },
    ]),
  ],
  controllers: [],
  providers: [ExpenseLimitsService],
  exports: [ExpenseLimitsService, MongooseModule],
})
export class ExpenseLimitsModule {}
