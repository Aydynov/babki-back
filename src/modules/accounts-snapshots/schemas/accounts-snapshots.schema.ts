import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Account } from '../../accounts/schemas/accounts.schema';

export type AccountSnapshotsDocument = HydratedDocument<AccountSnapshot>;

@Schema({ timestamps: true })
export class AccountSnapshot {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Account.name,
  })
  accountId: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  date: Date;
}

export const AccountsSnapshotsSchema =
  SchemaFactory.createForClass(AccountSnapshot);

AccountsSnapshotsSchema.index({ accountId: 1, date: -1 });
AccountsSnapshotsSchema.index({ accountId: 1, date: 1 }, { unique: true });
