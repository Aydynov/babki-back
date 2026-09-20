import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true, trim: true, maxlength: 100 }) name: string;
  @Prop({ required: true, enum: ['family', 'organization'] }) type: string;
  @Prop({ maxlength: 1000 }) description?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  ownerId: Types.ObjectId;
  @Prop({ type: Date, default: null }) deletedAt: Date | null;
  @Prop({ default: 0 }) mutationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}
export type GroupDocument = HydratedDocument<Group>;
export const GroupSchema = SchemaFactory.createForClass(Group);
GroupSchema.index({ ownerId: 1 });
