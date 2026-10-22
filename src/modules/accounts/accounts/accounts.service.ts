import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { DeletionTargetNotFoundException } from 'src/common/lifecycle/deletion-policy';
import {
  hasValidMoneyPrecision,
  normalizeCurrency,
} from 'src/common/money/money';
import { AccountsSnapshotsService } from 'src/modules/accounts-snapshots/accounts-snapshots.service';
import { TransactionsService } from 'src/modules/transactions/transactions/transactions.service';
import { FindAccountQueryDto } from '../dto/find-query.dto';
import {
  Account,
  AccountDocument,
  AccountType,
} from '../schemas/accounts.schema';
@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionService: TransactionsService,
  ) {}
  async createForBudget(
    budget: BudgetContext,
    dto: {
      type?: AccountType;
      name?: string;
      currency?: string;
      amount?: number;
      openedAt?: string;
    },
    session: ClientSession,
  ) {
    const amount = dto.amount ?? 0;
    const currency = normalizeCurrency(dto.currency!);
    if (!hasValidMoneyPrecision(amount, currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    const [createdEntity] = await this.accountModel.create(
      [
        {
          ...budgetFilter(budget),
          type: dto.type ?? 'balance',
          name: dto.name!.trim(),
          currency,
          initialAmount: amount,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : new Date(),
        },
      ],
      { session },
    );
    await this.snapshotsService.openingForBudget(createdEntity, session);
    return {
      ...createdEntity.toObject(),
      amount: await this.snapshotsService.balanceForBudget(
        createdEntity,
        new Date(),
        session,
      ),
      timeline: [],
    };
  }
  async listForBudget(budget: BudgetContext, query: FindAccountQueryDto = {}) {
    const filter = {
      ...budgetFilter(budget),
      ...(query.type ? { type: query.type } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
    };
    const lookup = this.accountModel.find(filter);
    const entities = await lookup.lean().exec();
    return this.responseForBudget(budget, entities, { toDate: query.toDate });
  }
  async getForBudget(budget: BudgetContext, id: string) {
    const account = await this.accountModel
      .findOne({ _id: id, ...budgetFilter(budget) })
      .lean()
      .exec();
    if (!account) throw new NotFoundException('Account not found');
    return (await this.responseForBudget(budget, [account]))[0];
  }
  private async responseForBudget(
    budget: BudgetContext,
    accounts: Array<
      Account & {
        _id: Types.ObjectId;
      }
    >,
    query?: {
      toDate?: string;
    },
    session?: ClientSession,
  ) {
    return Promise.all(
      accounts.map(async (account) => ({
        ...account,
        amount: await this.snapshotsService.balanceForBudget(
          account,
          new Date(),
          session,
        ),
        timeline: await this.snapshotsService.timelineForBudget(
          account._id,
          session,
        ),
      })),
    );
  }
  async renameForBudget(
    budget: BudgetContext,
    accountId: string,
    name: string,
    session?: ClientSession,
  ) {
    const account = await this.accountModel
      .findOneAndUpdate(
        { _id: accountId, ...budgetFilter(budget) },
        { $set: { name: name.trim() } },
        {
          returnDocument: 'after',
          runValidators: true,
          ...(session ? { session } : {}),
        },
      )
      .lean()
      .exec();
    if (!account) throw new NotFoundException('Account not found');
    return (
      await this.responseForBudget(budget, [account], undefined, session)
    )[0];
  }
  async removeForBudget(
    budget: BudgetContext,
    entityId: string,
    session: ClientSession,
  ) {
    await this.lockAccountForLifecycle(budget, entityId, session);
    const account = await this.accountModel
      .findOne({ _id: entityId, ...budgetFilter(budget) })
      .session(session)
      .lean()
      .exec();
    if (!account) throw new NotFoundException('Account not found');
    if (account.initialAmount !== 0) {
      throw new ConflictException('Wallet has financial history');
    }
    if (
      await this.transactionService.hasHistoryForBudget(
        budget,
        entityId,
        session,
      )
    ) {
      throw new ConflictException('Wallet has financial history');
    }
    await this.snapshotsService.deleteForBudget(budget, entityId, session);
    const deleted = await this.accountModel.findOneAndDelete(
      { _id: entityId, ...budgetFilter(budget) },
      { session },
    );
    if (!deleted) throw new DeletionTargetNotFoundException('Account');
    return null;
  }
  async archiveForBudget(
    budget: BudgetContext,
    entityId: string,
    session: ClientSession,
  ) {
    await this.lockAccountForLifecycle(budget, entityId, session);
    const archived = await this.accountModel
      .findOneAndUpdate(
        { _id: entityId, ...budgetFilter(budget), archivedAt: null },
        { $set: { archivedAt: new Date() } },
        { returnDocument: 'after', session },
      )
      .lean()
      .exec();
    if (!archived) throw new DeletionTargetNotFoundException('Account');
  }
  private async lockAccountForLifecycle(
    budget: BudgetContext,
    entityId: string,
    session: ClientSession,
  ) {
    const locked = await this.accountModel.updateOne(
      { _id: entityId, ...budgetFilter(budget) },
      { $inc: { mutationVersion: 1 } },
      { session },
    );
    if (!locked.matchedCount) {
      throw new DeletionTargetNotFoundException('Account');
    }
  }
}
