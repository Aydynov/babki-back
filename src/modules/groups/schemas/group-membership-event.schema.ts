import { type GroupPermissions, permissionFields } from '../group-permissions';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class GroupMembershipEvent {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  groupId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  actorId: Types.ObjectId;
  @Prop({
    required: true,
    enum: [
      'permissions-updated',
      'joined',
      'left',
      'removed',
      'ownership-transferred',
      'group-deleted',
    ],
  })
  kind: string;
  @Prop({ type: MongooseSchema.Types.ObjectId }) targetUserId?: Types.ObjectId;
  @Prop({ type: new MongooseSchema(permissionFields, { _id: false }) })
  before?: GroupPermissions;
  @Prop({ type: new MongooseSchema(permissionFields, { _id: false }) })
  after?: GroupPermissions;
  @Prop({
    type: [
      {
        _id: false,
        userId: MongooseSchema.Types.ObjectId,
        before: new MongooseSchema(permissionFields, { _id: false }),
        after: new MongooseSchema(permissionFields, { _id: false }),
      },
    ],
  })
  permissionResets?: {
    userId: Types.ObjectId;
    before: GroupPermissions;
    after: GroupPermissions;
  }[];
  @Prop({ required: true }) occurredAt: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  previousOwnerId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) newOwnerId?: Types.ObjectId;
}
export type GroupMembershipEventDocument =
  HydratedDocument<GroupMembershipEvent>;
export const GroupMembershipEventSchema =
  SchemaFactory.createForClass(GroupMembershipEvent);
GroupMembershipEventSchema.index({ groupId: 1, occurredAt: 1, _id: 1 });
