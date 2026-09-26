import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';

export const accountTypes = ['balance', 'saving'] as const;
export type AccountType = (typeof accountTypes)[number];

export type AccountDocument = HydratedDocument<Account>;

@Schema({ timestamps: true, discriminatorKey: 'type' })
export class Account {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'group'] })
  ownerType: 'user' | 'group';

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  ownerId: Types.ObjectId;

  @Prop({ default: 0 }) mutationVersion: number;
  @Prop({ type: Date, default: null }) archivedAt: Date | null;
  @Prop({ trim: true }) name?: string;
  @Prop({ type: String, enum: SUPPORTED_CURRENCY_CODES, immutable: true })
  currency?: string;
  @Prop({ immutable: true }) initialAmount?: number;
  @Prop({ immutable: true }) openedAt?: Date;

  type: AccountType;
}

export const AccountsSchema = SchemaFactory.createForClass(Account);

AccountsSchema.index({ ownerType: 1, ownerId: 1, archivedAt: 1 });
AccountsSchema.index({
  ownerType: 1,
  ownerId: 1,
  archivedAt: 1,
  currency: 1,
  type: 1,
});
