import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class GroupInvitation {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  groupId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy: Types.ObjectId;
  @Prop({ required: true, select: false }) tokenDigest: string;
  @Prop({ required: true }) expiresAt: Date;
  @Prop({
    required: true,
    enum: ['pending', 'accepted', 'revoked'],
    default: 'pending',
  })
  status: string;
  @Prop({ type: MongooseSchema.Types.ObjectId }) acceptedBy?: Types.ObjectId;
  @Prop() acceptedAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId }) revokedBy?: Types.ObjectId;
  @Prop() revokedAt?: Date;
  createdAt: Date;
}
export type GroupInvitationDocument = HydratedDocument<GroupInvitation>;
export const GroupInvitationSchema =
  SchemaFactory.createForClass(GroupInvitation);
GroupInvitationSchema.index({ tokenDigest: 1 }, { unique: true });
GroupInvitationSchema.index({ groupId: 1, createdAt: 1, _id: 1 });
