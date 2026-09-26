import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Transaction } from './transaction.schema';
import { Account } from '../../accounts/schemas/accounts.schema';
import { AccountSnapshot } from '../../accounts-snapshots/schemas/accounts-snapshots.schema';

@Schema()
export class Income extends Transaction {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Account.name,
  })
  declare accountId: Types.ObjectId;
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: AccountSnapshot.name,
  })
  declare snapshotId: Types.ObjectId;
  @Prop({ required: true }) declare amount: number;
  @Prop() declare currency?: string;
  @Prop({ trim: true })
  source?: string;
}

export const IncomeSchema = SchemaFactory.createForClass(Income);

export type IncomeDocument = HydratedDocument<Income>;
