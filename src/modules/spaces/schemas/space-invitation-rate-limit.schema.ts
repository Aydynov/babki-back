import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
@Schema({ timestamps: true })
export class SpaceInvitationRateLimit {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop({ required: true })
  windowStart: Date;
  @Prop({ required: true })
  count: number;
  @Prop({ required: true })
  expiresAt: Date;
}
export type SpaceInvitationRateLimitDocument =
  HydratedDocument<SpaceInvitationRateLimit>;
export const SpaceInvitationRateLimitSchema = SchemaFactory.createForClass(
  SpaceInvitationRateLimit,
);
SpaceInvitationRateLimitSchema.index(
  { userId: 1, windowStart: 1 },
  { unique: true },
);
SpaceInvitationRateLimitSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);
