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
      'joined',
      'left',
      'removed',
      'ownership-transferred',
      'group-deleted',
    ],
  })
  kind: string;
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
