import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
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
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async findByParams(userId: string, query: FindAccountQueryDto) {
    const foundUserId = await this.usersService.ensureIdExists(userId);
    const entities = await this.accountModel
      .find(this.buildFilter(foundUserId, query))
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!entities.length) {
      return [];
    }

    return this.buildResponse(entities, { toDate: query.toDate });
  }

  async create(userId: string, createAccountDto: CreateAccountDto) {
    const foundUserId = await this.usersService.ensureIdExists(userId);
    const currency = normalizeCurrency(createAccountDto.currency);
    const amount = createAccountDto.amount ?? 0;
    if (!hasValidMoneyPrecision(amount, currency))
      throw new BadRequestException('Amount exceeds currency precision.');

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const [createdEntity] = await this.accountModel.create(
          [
            {
              ...personalBudget(foundUserId),
              type: createAccountDto.type,
              name: createAccountDto.name.trim(),
              currency,
              initialAmount: amount,
              openedAt: createAccountDto.openedAt
                ? new Date(createAccountDto.openedAt)
                : new Date(),
            },
          ],
          { session },
        );
        const snapshot = await this.snapshotsService.create(
          userId,
          createdEntity._id.toString(),
          {
            amount,
            date: createAccountDto.openedAt
              ? new Date(createAccountDto.openedAt)
              : new Date(),
          },
          session,
        );
        if (createdEntity.type === 'balance') {
          await this.usersService.selectFirstDefaultAccount(
            userId,
            createdEntity._id,
            currency,
            session,
          );
        }
        const [response] = await this.buildResponse(
          [createdEntity.toObject()],
          undefined,
          [{ _id: createdEntity._id, documents: [snapshot] }],
        );
        return response;
      });
    } finally {
      await session.endSession();
    }
  }

  async findOne(userId: string, accountId: string) {
    const account = await this.accountModel
      .findOne({ _id: accountId, ...personalBudget(userId) })
      .lean()
      .exec();
    if (!account)
      throw new NotFoundException(`Account ${accountId} not found.`);
    return (await this.buildResponse([account]))[0];
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
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        await this.lockAccountForLifecycle(userId, entityId, session);
        const account = await this.accountModel
          .findOne({ _id: entityId, ...personalBudget(userId) })
          .session(session)
          .lean()
          .exec();
        if (!account) throw new DeletionTargetNotFoundException('Account');
        if ((account.initialAmount ?? 0) !== 0) {
          throw new DeletionRestrictedException(
            'Account with an initial balance cannot be deleted',
          );
        }
        if (
          await this.transactionService.hasHistoryByAccountId(
            userId,
            entityId,
            session,
          )
        ) {
          throw new DeletionRestrictedException(
            'Account has financial history',
          );
        }
        await this.snapshotsService.deleteAllByAccountId(
          userId,
          entityId,
          session,
        );
        const deleted = await this.accountModel.findOneAndDelete(
          { _id: entityId, ...personalBudget(userId) },
          { session },
        );
        if (!deleted) throw new DeletionTargetNotFoundException('Account');
        await this.usersService.clearDefaultAccount(userId, entityId, session);
        return null;
      });
    } finally {
      await session.endSession();
    }
  }

  async archive(userId: string, entityId: string) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
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
    } finally {
      await session.endSession();
    }
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

  private buildFilter(userId: Types.ObjectId, params: FindAccountQueryDto) {
    const filter: {
      userId: Types.ObjectId;
      ownerType: 'user';
      ownerId: Types.ObjectId;
      type?: AccountType;
      currency?: string;
    } = { ...personalBudget(userId) };

    if (params.type) {
      filter.type = params.type;
    }
    if (params.currency) filter.currency = params.currency;

    return filter;
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
