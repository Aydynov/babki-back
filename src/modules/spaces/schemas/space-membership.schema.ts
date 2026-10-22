import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { type SpacePermissions, permissionFields } from '../space-permissions';
export const membershipEndReasons = [
  'member_left',
  'member_removed',
  'space_deleted',
  'user_deleted',
] as const;
export type MembershipEndReason = (typeof membershipEndReasons)[number];
@Schema({ timestamps: true })
export class SpaceMembership {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  spaceId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop({ required: true, enum: ['active', 'left', 'removed'] })
  status: string;
  @Prop({ required: true })
  joinedAt: Date;
  @Prop({
    type: new MongooseSchema(permissionFields, { _id: false }),
    default: () => ({}),
  })
  permissions: SpacePermissions;
  @Prop()
  endedAt?: Date;
  @Prop({ type: String, enum: membershipEndReasons, default: null })
  endReason: MembershipEndReason | null;
}
export type SpaceMembershipDocument = HydratedDocument<SpaceMembership>;
export const SpaceMembershipSchema =
  SchemaFactory.createForClass(SpaceMembership);
SpaceMembershipSchema.index({ spaceId: 1, userId: 1 }, { unique: true });
SpaceMembershipSchema.index({ userId: 1, status: 1, spaceId: 1 });
SpaceMembershipSchema.index({ spaceId: 1, status: 1, joinedAt: 1, _id: 1 });
