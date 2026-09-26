import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export const transactionTypes = ['income', 'expense', 'transfer'] as const;
export type TransactionType = (typeof transactionTypes)[number];
export const transactionOriginTypes = ['plan', 'debt'] as const;
export type TransactionOriginType = (typeof transactionOriginTypes)[number];

@Schema({ _id: false })
export class TransactionOrigin {
  @Prop({ required: true, type: String, enum: transactionOriginTypes })
  type: TransactionOriginType;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  id: Types.ObjectId;
}

export const TransactionOriginSchema =
  SchemaFactory.createForClass(TransactionOrigin);

export type TransactionDocument = HydratedDocument<Transaction>;

@Schema({ timestamps: true, discriminatorKey: 'type' })
export class Transaction {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'group'] })
  ownerType: 'user' | 'group';

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  ownerId: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  createdBy: Types.ObjectId;
  @Prop() deletedAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId }) deletedBy?: Types.ObjectId;

  @Prop({ type: TransactionOriginSchema, immutable: true, default: null })
  origin: TransactionOrigin | null;

  snapshotId: Types.ObjectId;

  accountId: Types.ObjectId;

  amount: number;

  currency?: string;

  @Prop({ required: true })
  transactionDate: Date;

  @Prop({ trim: true })
  description?: string;

  type: TransactionType;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({
  userId: 1,
  snapshotId: 1,
  deletedAt: 1,
  transactionDate: -1,
  _id: -1,
});

TransactionSchema.index({
  ownerType: 1,
  ownerId: 1,
  deletedAt: 1,
  transactionDate: -1,
  _id: -1,
});
TransactionSchema.index({
  ownerType: 1,
  ownerId: 1,
  deletedAt: 1,
  type: 1,
  transactionDate: -1,
  _id: -1,
});
TransactionSchema.index({
  accountId: 1,
  deletedAt: 1,
  transactionDate: -1,
  _id: -1,
});
TransactionSchema.index({
  ownerType: 1,
  ownerId: 1,
  participantId: 1,
  deletedAt: 1,
  transactionDate: -1,
  _id: -1,
});
TransactionSchema.index({
  category: 1,
  deletedAt: 1,
  transactionDate: -1,
  _id: -1,
});
TransactionSchema.index({ 'origin.type': 1, 'origin.id': 1 });
