import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class GroupInvitationRateLimit {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop({ required: true }) windowStart: Date;
  @Prop({ required: true }) count: number;
  @Prop({ required: true }) expiresAt: Date;
}
export type GroupInvitationRateLimitDocument =
  HydratedDocument<GroupInvitationRateLimit>;
export const GroupInvitationRateLimitSchema = SchemaFactory.createForClass(
  GroupInvitationRateLimit,
);
GroupInvitationRateLimitSchema.index(
  { userId: 1, windowStart: 1 },
  { unique: true },
);
GroupInvitationRateLimitSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);
