import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export type ExpenseCategoryDocument = HydratedDocument<ExpenseCategory>;
@Schema({ timestamps: true })
export class ExpenseCategory {
  @Prop({ required: true, trim: true })
  name: string;
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: 'Space',
    immutable: true,
  })
  spaceId: Types.ObjectId;
  @Prop({ trim: true })
  description?: string;
  @Prop({ trim: true })
  color?: string;
  @Prop({ default: false })
  isArchived: boolean;
  @Prop({ default: 0 })
  mutationVersion: number;
}
export const ExpenseCategorySchema =
  SchemaFactory.createForClass(ExpenseCategory);
ExpenseCategorySchema.index({ spaceId: 1, name: 1 }, { unique: true });
ExpenseCategorySchema.index({
  spaceId: 1,
  isArchived: 1,
  createdAt: -1,
});
