import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { type SpacePermissions, permissionFields } from '../space-permissions';
@Schema({ timestamps: true })
export class SpaceMembershipEvent {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  spaceId: Types.ObjectId;
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
      'space-deleted',
    ],
  })
  kind: string;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  targetUserId?: Types.ObjectId;
  @Prop({ type: new MongooseSchema(permissionFields, { _id: false }) })
  before?: SpacePermissions;
  @Prop({ type: new MongooseSchema(permissionFields, { _id: false }) })
  after?: SpacePermissions;
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
    before: SpacePermissions;
    after: SpacePermissions;
  }[];
  @Prop({ required: true })
  occurredAt: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  previousOwnerId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  newOwnerId?: Types.ObjectId;
}
export type SpaceMembershipEventDocument =
  HydratedDocument<SpaceMembershipEvent>;
export const SpaceMembershipEventSchema =
  SchemaFactory.createForClass(SpaceMembershipEvent);
SpaceMembershipEventSchema.index({ spaceId: 1, occurredAt: 1, _id: 1 });
