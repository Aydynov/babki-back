import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { BudgetWriteService } from '../../budgets/budget-write.service';
import {
  DeletionRestrictedException,
  DeletionTargetNotFoundException,
} from 'src/common/lifecycle/deletion-policy';
import { AccountsSnapshotsService } from 'src/modules/accounts-snapshots/accounts-snapshots.service';
import { AccountSnapshotsDocument } from 'src/modules/accounts-snapshots/schemas/accounts-snapshots.schema';
import { TransactionsService } from 'src/modules/transactions/transactions/transactions.service';
import { UsersService } from '../../users/users.service';
import { CreateAccountDto } from '../dto/create.dto';
import { FindAccountQueryDto } from '../dto/find-query.dto';
import {
  Account,
  AccountDocument,
  AccountType,
} from '../schemas/accounts.schema';
import {
  hasValidMoneyPrecision,
  normalizeCurrency,
} from 'src/common/money/money';

@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
    private readonly usersService: UsersService,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionService: TransactionsService,
    private readonly write: BudgetWriteService,
  ) {}

  async findByParams(userId: string, query: FindAccountQueryDto) {
    const foundUserId = await this.usersService.ensureIdExists(userId);
    return this.listForBudget(personalBudget(foundUserId), query);
  }

  async create(userId: string, createAccountDto: CreateAccountDto) {
    const foundUserId = await this.usersService.ensureIdExists(userId);
    return this.write.run(personalBudget(foundUserId), userId, (session) =>
      this.createForBudget(
        personalBudget(foundUserId),
        createAccountDto,
        session,
      ),
    );
  }

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
    const personal = budget.ownerType === 'user';
    const amount = dto.amount ?? 0;
    const currency = personal ? normalizeCurrency(dto.currency!) : undefined;
    if (currency && !hasValidMoneyPrecision(amount, currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    if (
      !personal &&
      (await this.accountModel
        .exists({ ...budgetFilter(budget), type: 'balance' })
        .session(session))
    )
      throw new ConflictException('Wallet already exists');
    const [createdEntity] = await this.accountModel.create(
      [
        {
          ...budgetFilter(budget),
          type: personal ? dto.type : 'balance',
          ...(personal ? { name: dto.name!.trim(), currency } : {}),
          initialAmount: amount,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : new Date(),
        },
      ],
      { session },
    );
    const snapshot = await this.snapshotsService.openingForBudget(
      createdEntity,
      session,
    );
    if (!personal)
      return {
        ...createdEntity.toObject(),
        amount: await this.snapshotsService.balanceForBudget(
          createdEntity,
          new Date(),
          session,
        ),
        timeline: [],
      };
    if (createdEntity.type === 'balance') {
      await this.usersService.selectFirstDefaultAccount(
        String(budget.ownerId),
        createdEntity._id,
        currency!,
        session,
      );
    }
    const [response] = await this.buildResponse(
      [createdEntity.toObject()],
      undefined,
      [{ _id: createdEntity._id, documents: [snapshot] }],
    );
    return response;
  }

  async listForBudget(budget: BudgetContext, query: FindAccountQueryDto = {}) {
    const filter = {
      ...budgetFilter(budget),
      ...(query.type ? { type: query.type } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
    };
    const lookup = this.accountModel.find(filter);
    if (budget.ownerType === 'user') lookup.sort({ createdAt: -1 });
    const entities = await lookup.lean().exec();
    return this.responseForBudget(budget, entities, { toDate: query.toDate });
  }

  async getForBudget(budget: BudgetContext, id: string) {
    const account = await this.accountModel
      .findOne({ _id: id, ...budgetFilter(budget) })
      .lean()
      .exec();
    if (!account)
      throw new NotFoundException(
        budget.ownerType === 'user'
          ? `Account ${id} not found.`
          : 'Account not found',
      );
    return (await this.responseForBudget(budget, [account]))[0];
  }

  private async responseForBudget(
    budget: BudgetContext,
    accounts: Array<Account & { _id: Types.ObjectId }>,
    query?: { toDate?: string },
  ) {
    if (budget.ownerType === 'user')
      return this.buildResponse(accounts as AccountDocument[], query);
    return Promise.all(
      accounts.map(async (account) => ({
        ...account,
        amount: await this.snapshotsService.balanceForBudget(
          account,
          new Date(),
        ),
        timeline: await this.snapshotsService.timelineForBudget(account._id),
      })),
    );
  }

  async findOne(userId: string, accountId: string) {
    return this.getForBudget(personalBudget(userId), accountId);
  }

  async rename(userId: string, accountId: string, name: string) {
    const account = await this.accountModel
      .findOneAndUpdate(
        { _id: accountId, ...personalBudget(userId) },
        { $set: { name: name.trim() } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!account)
      throw new NotFoundException(`Account ${accountId} not found.`);
    return (await this.buildResponse([account]))[0];
  }

  async deleteEntity(userId: string, entityId: string) {
    return this.write.run(personalBudget(userId), userId, (session) =>
      this.removeForBudget(personalBudget(userId), entityId, session),
    );
  }

  async removeForBudget(
    budget: BudgetContext,
    entityId: string,
    session: ClientSession,
  ) {
    const personal = budget.ownerType === 'user';
    const userId = String(budget.ownerId);
    if (personal) await this.lockAccountForLifecycle(userId, entityId, session);
    const account = await this.accountModel
      .findOne({ _id: entityId, ...budgetFilter(budget) })
      .session(session)
      .lean()
      .exec();
    if (!account)
      throw personal
        ? new DeletionTargetNotFoundException('Account')
        : new NotFoundException('Account not found');
    if (
      (personal ? (account.initialAmount ?? 0) : account.initialAmount) !== 0
    ) {
      if (!personal)
        throw new ConflictException('Wallet has financial history');
      throw new DeletionRestrictedException(
        'Account with an initial balance cannot be deleted',
      );
    }
    if (
      await this.transactionService.hasHistoryForBudget(
        budget,
        entityId,
        session,
      )
    ) {
      if (!personal)
        throw new ConflictException('Wallet has financial history');
      throw new DeletionRestrictedException('Account has financial history');
    }
    await this.snapshotsService.deleteForBudget(budget, entityId, session);
    const deleted = await this.accountModel.findOneAndDelete(
      { _id: entityId, ...budgetFilter(budget) },
      { session },
    );
    if (!deleted) throw new DeletionTargetNotFoundException('Account');
    if (personal)
      await this.usersService.clearDefaultAccount(userId, entityId, session);
    return null;
  }

  async archive(userId: string, entityId: string) {
    return this.write.run(personalBudget(userId), userId, async (session) => {
      await this.lockAccountForLifecycle(userId, entityId, session);
      const archived = await this.accountModel
        .findOneAndUpdate(
          {
            _id: entityId,
            ...personalBudget(userId),
            archivedAt: null,
          },
          { $set: { archivedAt: new Date() } },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!archived) throw new DeletionTargetNotFoundException('Account');
      await this.usersService.clearDefaultAccount(userId, entityId, session);
    });
  }

  async buildResponse(
    entities: AccountDocument[],
    query?: { toDate?: string },
    existingSnapshots?: {
      _id: Types.ObjectId;
      documents: AccountSnapshotsDocument[];
    }[],
  ) {
    const snapshotGroups =
      existingSnapshots ??
      (await this.snapshotsService.findAllByAccounts(
        entities.map((entity) => entity._id),
        query,
      ));

    return entities.map((entity) => {
      const entitySnapshots: AccountSnapshotsDocument[] =
        snapshotGroups.find(
          (group) => group._id.toString() === entity._id.toString(),
        )?.documents ?? [];
      return {
        ...personalResponse(entity),
        initialAmount: entity.initialAmount ?? 0,
        openedAt: entity.openedAt,
        amount: entitySnapshots[0]?.amount ?? 0,
        timeline: entitySnapshots,
      };
    });
  }

  private async lockAccountForLifecycle(
    userId: string,
    entityId: string,
    session: ClientSession,
  ) {
    const locked = await this.accountModel.updateOne(
      { _id: entityId, ...personalBudget(userId) },
      { $inc: { mutationVersion: 1 } },
      { session },
    );
    if (!locked.matchedCount) {
      throw new DeletionTargetNotFoundException('Account');
    }
  }
}
