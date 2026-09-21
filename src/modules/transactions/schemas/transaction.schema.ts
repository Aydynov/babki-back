import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { AccountSnapshot } from '../../accounts-snapshots/schemas/accounts-snapshots.schema';
import { Account } from '../../accounts/schemas/accounts.schema';
import { User } from '../../users/schemas/user.schema';

export const transactionTypes = ['income', 'expense', 'save'] as const;
export type TransactionType = (typeof transactionTypes)[number];

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

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: AccountSnapshot.name,
  })
  snapshotId: Types.ObjectId;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Account.name,
  })
  accountId: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

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
  transactionDate: -1,
});

TransactionSchema.index({
  ownerType: 1,
  ownerId: 1,
  transactionDate: -1,
  _id: -1,
});
TransactionSchema.index({
  ownerType: 1,
  ownerId: 1,
  participantId: 1,
  transactionDate: -1,
});
