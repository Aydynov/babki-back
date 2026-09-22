import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionsModule } from '../transactions/transactions.module';
import {
  ExpenseLimit,
  ExpenseLimitSchema,
} from '../expense-limits/schemas/expense-limit.schema';
import { Plan, PlanSchema } from '../plans/schemas/plan.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from './schemas/expense-category.schema';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';

@Module({
  imports: [
    TransactionsModule,
    MongooseModule.forFeature([
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: User.name, schema: UserSchema },
      { name: ExpenseLimit.name, schema: ExpenseLimitSchema },
      { name: Plan.name, schema: PlanSchema },
    ]),
  ],
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService],
  exports: [ExpenseCategoriesService, MongooseModule],
})
export class ExpenseCategoriesModule {}
