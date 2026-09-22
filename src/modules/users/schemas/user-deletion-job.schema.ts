import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from './user.schema';

export const userDeletionStages = [
  'memberships',
  'personal_finance',
  'auth_data',
  'tombstone',
  'completed',
] as const;
export type UserDeletionStage = (typeof userDeletionStages)[number];

@Schema({ timestamps: true })
export class UserDeletionJob {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
  })
  userId: Types.ObjectId;

  @Prop({
    required: true,
    type: String,
    enum: userDeletionStages,
    default: 'memberships',
  })
  stage: UserDeletionStage;

  @Prop({ type: String, default: null })
  leaseOwner: string | null;

  @Prop({ type: Date, default: null })
  leaseExpiresAt: Date | null;

  @Prop({ default: 0, min: 0 })
  attempts: number;

  @Prop({ type: String, default: null, maxlength: 200, select: false })
  lastError: string | null;

  @Prop({ type: Date, default: Date.now })
  requestedAt: Date;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export type UserDeletionJobDocument = HydratedDocument<UserDeletionJob>;
export const UserDeletionJobSchema =
  SchemaFactory.createForClass(UserDeletionJob);

UserDeletionJobSchema.index({ userId: 1 }, { unique: true });
UserDeletionJobSchema.index(
  { requestedAt: 1 },
  { partialFilterExpression: { completedAt: null } },
);
