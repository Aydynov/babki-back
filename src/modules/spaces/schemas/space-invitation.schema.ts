import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export const invitationRevocationReasons = ['manual', 'space_deleted'] as const;
export type InvitationRevocationReason =
  (typeof invitationRevocationReasons)[number];
@Schema({ timestamps: true })
export class SpaceInvitation {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  spaceId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy: Types.ObjectId;
  @Prop({ required: true, select: false })
  tokenDigest: string;
  @Prop({ required: true })
  expiresAt: Date;
  @Prop({
    required: true,
    enum: ['pending', 'accepted', 'revoked'],
    default: 'pending',
  })
  status: string;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  acceptedBy?: Types.ObjectId;
  @Prop()
  acceptedAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  revokedBy?: Types.ObjectId;
  @Prop()
  revokedAt?: Date;
  @Prop({
    type: String,
    enum: invitationRevocationReasons,
    default: null,
  })
  revocationReason: InvitationRevocationReason | null;
  createdAt: Date;
}
export type SpaceInvitationDocument = HydratedDocument<SpaceInvitation>;
export const SpaceInvitationSchema =
  SchemaFactory.createForClass(SpaceInvitation);
SpaceInvitationSchema.index({ tokenDigest: 1 }, { unique: true });
SpaceInvitationSchema.index({ spaceId: 1, createdAt: 1, _id: 1 });
SpaceInvitationSchema.index({ spaceId: 1, status: 1 });
