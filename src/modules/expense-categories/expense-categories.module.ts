import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ExpenseLimit,
  ExpenseLimitSchema,
} from '../expense-limits/schemas/expense-limit.schema';
import { Plan, PlanSchema } from '../plans/schemas/plan.schema';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from './schemas/expense-category.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: User.name, schema: UserSchema },
      { name: ExpenseLimit.name, schema: ExpenseLimitSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [],
  providers: [ExpenseCategoriesService],
  exports: [ExpenseCategoriesService, MongooseModule],
})
export class ExpenseCategoriesModule {}
