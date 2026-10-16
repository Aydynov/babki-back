import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from '../expense-categories/schemas/expense-category.schema';
import {
  ExpenseLimit,
  ExpenseLimitSchema,
} from './schemas/expense-limit.schema';
import { ExpenseLimitsController } from './expense-limits.controller';
import { ExpenseLimitsService } from './expense-limits.service';

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
  controllers: [ExpenseLimitsController],
  providers: [ExpenseLimitsService],
  exports: [ExpenseLimitsService, MongooseModule],
})
export class ExpenseLimitsModule {}
