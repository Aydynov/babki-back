import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { personalBudget } from 'src/common/utils/personal-budget.util';
import { Account } from './schemas/accounts.schema';

@Injectable()
export class AccountsLookupService {
  constructor(
    @InjectModel(Account.name) private readonly accounts: Model<Account>,
  ) {}

  findPersonalAccount(
    userId: string,
    accountId: string,
    session: ClientSession,
  ) {
    return this.accounts
      .findOne({
        _id: new Types.ObjectId(accountId),
        ...personalBudget(userId),
      })
      .session(session)
      .lean()
      .exec();
  }
}
