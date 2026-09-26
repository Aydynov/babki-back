import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { AccountSnapshot } from '../../accounts-snapshots/schemas/accounts-snapshots.schema';
import { Account } from '../../accounts/schemas/accounts.schema';
import { Transaction } from './transaction.schema';

@Schema({ _id: false })
export class TransferEffect {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Account.name,
  })
  accountId: Types.ObjectId;
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: AccountSnapshot.name,
  })
  snapshotId: Types.ObjectId;
  @Prop({ required: true, min: Number.EPSILON }) amount: number;
  @Prop({ required: true }) currency: string;
}

export const TransferEffectSchema =
  SchemaFactory.createForClass(TransferEffect);

@Schema()
export class Transfer extends Transaction {
  @Prop({ required: true, type: TransferEffectSchema }) source: TransferEffect;
  @Prop({ required: true, type: TransferEffectSchema })
  destination: TransferEffect;
}

export const TransferSchema = SchemaFactory.createForClass(Transfer);
TransferSchema.index({ 'source.accountId': 1, transactionDate: -1 });
TransferSchema.index({ 'destination.accountId': 1, transactionDate: -1 });
export type TransferDocument = HydratedDocument<Transfer>;
