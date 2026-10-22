import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Debt } from '../../debts/schemas/debt.schema';
import { User } from '../../users/schemas/user.schema';
export type DebtTransactionDocument = HydratedDocument<DebtTransaction>;
@Schema({ timestamps: true })
export class DebtTransaction {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    immutable: true,
    ref: 'Space',
  })
  spaceId: Types.ObjectId;
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    immutable: true,
  })
  createdBy: Types.ObjectId;
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: Debt.name })
  debtId: Types.ObjectId;
  @Prop({ required: true, min: 0 })
  amount: number;
  @Prop({ required: true })
  transactionDate: Date;
  @Prop({ type: Boolean })
  isIncome?: boolean;
  @Prop({ type: MongooseSchema.Types.ObjectId, immutable: true })
  incomeId?: Types.ObjectId;
  @Prop({ type: Date })
  cancelledAt?: Date | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  cancelledBy?: Types.ObjectId;
  @Prop({ trim: true })
  description?: string;
}
export const DebtTransactionSchema =
  SchemaFactory.createForClass(DebtTransaction);
DebtTransactionSchema.index({
  debtId: 1,
  transactionDate: -1,
  createdAt: -1,
});
DebtTransactionSchema.index({
  spaceId: 1,
  debtId: 1,
  transactionDate: -1,
  createdAt: -1,
  _id: -1,
});
DebtTransactionSchema.index(
  { incomeId: 1 },
  {
    unique: true,
    partialFilterExpression: { incomeId: { $type: 'objectId' } },
  },
);
