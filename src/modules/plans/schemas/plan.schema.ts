import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ExpenseCategory } from '../../expense-categories/schemas/expense-category.schema';
import { Expense } from '../../transactions/schemas/expense.schema';
import { User } from '../../users/schemas/user.schema';

export type PlanDocument = HydratedDocument<Plan>;
export const planStatuses = ['active', 'closed'] as const;
export type PlanStatus = (typeof planStatuses)[number];

@Schema({ timestamps: true })
export class Plan {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: User.name })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 500 })
  description: string;

  @Prop({ required: true })
  targetDate: Date;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: ExpenseCategory.name,
  })
  categoryId: Types.ObjectId;

  @Prop({ required: true, type: String, enum: planStatuses, default: 'active' })
  status: PlanStatus;

  @Prop({ type: Date, default: null })
  archivedAt: Date | null;

  @Prop()
  closedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Expense.name })
  expenseId?: Types.ObjectId;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);

PlanSchema.index({
  userId: 1,
  archivedAt: 1,
  targetDate: 1,
  createdAt: -1,
});
PlanSchema.index({
  userId: 1,
  archivedAt: 1,
  status: 1,
  targetDate: 1,
  createdAt: -1,
});
PlanSchema.index({ categoryId: 1 });
PlanSchema.index({ expenseId: 1 });
