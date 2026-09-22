import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Debt } from '../../debts/schemas/debt.schema';
import { User } from '../../users/schemas/user.schema';

export type DebtTransactionDocument = HydratedDocument<DebtTransaction>;

@Schema({ timestamps: true })
export class DebtTransaction {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: User.name })
  userId: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: Debt.name })
  debtId: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true })
  transactionDate: Date;

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
DebtTransactionSchema.index({ userId: 1 });
