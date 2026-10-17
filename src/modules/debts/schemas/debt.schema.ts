import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type DebtDocument = HydratedDocument<Debt>;
export const debtStatuses = ['active', 'closed'] as const;
export type DebtStatus = (typeof debtStatuses)[number];

@Schema({ timestamps: true })
export class Debt {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    immutable: true,
  })
  userId?: Types.ObjectId;

  @Prop({
    required: true,
    type: String,
    enum: ['user', 'group'],
    immutable: true,
  })
  ownerType: 'user' | 'group';

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    immutable: true,
  })
  ownerId: Types.ObjectId;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    immutable: true,
  })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true })
  debtor: string;

  @Prop({ required: true, min: 0 })
  principalAmount: number;

  @Prop({ required: true, min: 0 })
  remainingAmount: number;

  @Prop({ required: true, immutable: true })
  currency: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: Date })
  dueDate?: Date | null;

  @Prop({ required: true, type: String, enum: debtStatuses, default: 'active' })
  status: DebtStatus;

  @Prop({ type: Date, default: null })
  archivedAt: Date | null;
}

export const DebtSchema = SchemaFactory.createForClass(Debt);

DebtSchema.index({ userId: 1, archivedAt: 1, createdAt: -1 });
DebtSchema.index({
  userId: 1,
  archivedAt: 1,
  status: 1,
  currency: 1,
  createdAt: -1,
});

DebtSchema.index({
  ownerType: 1,
  ownerId: 1,
  archivedAt: 1,
  createdAt: -1,
  _id: -1,
});
DebtSchema.index({
  ownerType: 1,
  ownerId: 1,
  archivedAt: 1,
  status: 1,
  currency: 1,
  createdAt: -1,
  _id: -1,
});
