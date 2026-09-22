import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ExpenseCategory } from '../../expense-categories/schemas/expense-category.schema';
import { User } from '../../users/schemas/user.schema';

export type ExpenseLimitDocument = HydratedDocument<ExpenseLimit>;

@Schema({ timestamps: true })
export class ExpenseLimit {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'group'] })
  ownerType: 'user' | 'group';

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  ownerId: Types.ObjectId;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: ExpenseCategory.name,
  })
  category: Types.ObjectId;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, type: Number, min: 0 })
  total: number;
}

export const ExpenseLimitSchema = SchemaFactory.createForClass(ExpenseLimit);

ExpenseLimitSchema.index({
  ownerType: 1,
  ownerId: 1,
  startDate: -1,
  endDate: -1,
  createdAt: -1,
});
ExpenseLimitSchema.index({
  ownerType: 1,
  ownerId: 1,
  category: 1,
  startDate: -1,
  endDate: -1,
  createdAt: -1,
});
