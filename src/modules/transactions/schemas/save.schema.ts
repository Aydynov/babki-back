import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Account } from '../../accounts/schemas/accounts.schema';
import { Transaction } from './transaction.schema';

@Schema()
export class Save extends Transaction {
  @Prop({ required: true, type: Types.ObjectId, ref: Account.name })
  sourceAccountId: Types.ObjectId;
}

export const SaveSchema = SchemaFactory.createForClass(Save);

export type SaveDocument = HydratedDocument<Save>;
