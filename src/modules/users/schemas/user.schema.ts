import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const userStatuses = ['active', 'deletion_pending', 'deleted'] as const;
export type UserStatus = (typeof userStatuses)[number];

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, type: String, enum: userStatuses, default: 'active' })
  status: UserStatus;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ default: 0, select: false })
  authVersion: number;

  @Prop({ trim: true })
  description?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ status: 1, deletedAt: 1 });
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);

export type UserDocument = HydratedDocument<User>;
