import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Transaction } from './transaction.schema';
import { ExpenseCategory } from 'src/modules/expense-categories/schemas/expense-category.schema';
import { Account } from '../../accounts/schemas/accounts.schema';
import { AccountSnapshot } from '../../accounts-snapshots/schemas/accounts-snapshots.schema';

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ _id: false })
export class ExpenseItem {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, min: 0.01 })
  price: number;

  @Prop({ required: true, min: Number.EPSILON })
  quantity: number;
}

export const ExpenseItemSchema = SchemaFactory.createForClass(ExpenseItem);

@Schema()
export class Expense extends Transaction {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Account.name,
  })
  declare accountId: Types.ObjectId;
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: AccountSnapshot.name,
  })
  declare snapshotId: Types.ObjectId;
  @Prop({ required: true }) declare amount: number;
  @Prop() declare currency?: string;
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  participantId: Types.ObjectId;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: ExpenseCategory.name,
  })
  category: Types.ObjectId;

  @Prop({ trim: true })
  merchant?: string;

  @Prop({ type: [ExpenseItemSchema], default: [] })
  items: ExpenseItem[];
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
