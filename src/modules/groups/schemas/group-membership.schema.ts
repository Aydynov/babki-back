import { type GroupPermissions, permissionFields } from '../group-permissions';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const membershipEndReasons = [
  'member_left',
  'member_removed',
  'group_deleted',
  'user_deleted',
] as const;
export type MembershipEndReason = (typeof membershipEndReasons)[number];

@Schema({ timestamps: true })
export class GroupMembership {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  groupId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop({ required: true, enum: ['active', 'left', 'removed'] }) status: string;
  @Prop({ required: true }) joinedAt: Date;
  @Prop({
    type: new MongooseSchema(permissionFields, { _id: false }),
    default: () => ({}),
  })
  permissions: GroupPermissions;
  @Prop() endedAt?: Date;
  @Prop({ type: String, enum: membershipEndReasons, default: null })
  endReason: MembershipEndReason | null;
}
export type GroupMembershipDocument = HydratedDocument<GroupMembership>;
export const GroupMembershipSchema =
  SchemaFactory.createForClass(GroupMembership);
GroupMembershipSchema.index({ groupId: 1, userId: 1 }, { unique: true });
GroupMembershipSchema.index({ userId: 1, status: 1, groupId: 1 });
GroupMembershipSchema.index({ groupId: 1, status: 1 });
