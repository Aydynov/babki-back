import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export const accountTypes = ['balance', 'saving'] as const;
export type AccountType = (typeof accountTypes)[number];

export type AccountDocument = HydratedDocument<Account>;

// TODO Добавить валюту
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
  @Prop() initialAmount?: number;
  @Prop() openedAt?: Date;

  type: AccountType;
}

export const AccountsSchema = SchemaFactory.createForClass(Account);

AccountsSchema.index(
  { ownerType: 1, ownerId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { ownerType: 'group', type: 'balance' },
  },
);

AccountsSchema.index({ ownerType: 1, ownerId: 1 });
AccountsSchema.index({ ownerType: 1, ownerId: 1, archivedAt: 1 });
