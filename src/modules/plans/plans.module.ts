import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from '../expense-categories/schemas/expense-category.schema';
import { TransactionsModule } from '../transactions/transactions.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PlansService } from './plans.service';
import { Plan, PlanSchema } from './schemas/plan.schema';
@Module({
  imports: [
    TransactionsModule,
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: User.name, schema: UserSchema },
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
    ]),
  ],
  controllers: [],
  providers: [PlansService],
  exports: [PlansService, MongooseModule],
})
export class PlansModule implements OnModuleInit {
  constructor(
    @InjectModel(Plan.name)
    private readonly plans: Model<Plan>,
  ) {}
  async onModuleInit() {
    await this.plans.createIndexes();
  }
}
