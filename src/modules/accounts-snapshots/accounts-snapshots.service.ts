import { personalBudget } from 'src/common/utils/personal-budget.util';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { startOfMonth } from 'date-fns/startOfMonth';
import { ClientSession, Model, Types } from 'mongoose';
import { Account, AccountDocument } from '../accounts/schemas/accounts.schema';
import { CreateAccountSnapshotDto } from './dto/create.dto';
import { UpdateAccountSnapshotQueryDto } from './dto/update-query.dto';
import { UpdateAccountSnapshotDto } from './dto/update.dto';
import {
  AccountSnapshot,
  AccountSnapshotsDocument,
} from './schemas/accounts-snapshots.schema';

@Injectable()
export class AccountsSnapshotsService {
  constructor(
    @InjectModel(AccountSnapshot.name)
    private readonly snapshotsModel: Model<AccountSnapshotsDocument>,
    @InjectModel(Account.name)
    private readonly accountsModel: Model<AccountDocument>,
  ) {}

  async findByAccountId(
    userId: string,
    accountId: string,
    date?: string,
    session?: ClientSession,
  ) {
    const foundAccountId = await this.ensureAccountExists(
      userId,
      accountId,
      session,
    );
    const requestedDate = date ? new Date(date) : new Date();

    const entity = await this.snapshotsModel
      .findOne({
        accountId: foundAccountId,
        date: { $lte: requestedDate },
      })
      .sort({ date: -1, createdAt: -1 })
      .session(session ?? null)
      .lean();

    if (!entity) {
      return null;
    }

    return entity;
  }

  async findByUserId(userId: string, date?: string) {
    const foundAccounts = await this.findAccounts(userId);
    const requestedDate = date ? new Date(date) : new Date();

    return this.snapshotsModel
      .find({
        accountId: {
          $in: foundAccounts.map((account) => account._id),
        },
        date: { $lte: requestedDate },
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();
  }

  async findOrCreateByAccountId(
    userId: string,
    accountId: string,
    date?: string,
    session?: ClientSession,
  ) {
    const foundSnapshot = await this.findByAccountId(
      userId,
      accountId,
      date,
      session,
    );
    const resolvedDate = date ? new Date(date) : new Date();
    if (
      !foundSnapshot ||
      foundSnapshot.date.getMonth() !== resolvedDate.getMonth() ||
      foundSnapshot.date.getFullYear() !== resolvedDate.getFullYear()
    ) {
      const [createdSnapshot] = await this.snapshotsModel.create(
        [
          {
            accountId: new Types.ObjectId(accountId),
            amount: foundSnapshot?.amount ?? 0,
            date: startOfMonth(resolvedDate),
          },
        ],
        { session },
      );
      return createdSnapshot.toObject();
    }
    return foundSnapshot;
  }

  async create(
    userId: string,
    accountId: string,
    createSnapshotDto: CreateAccountSnapshotDto,
    session?: ClientSession,
  ): Promise<AccountSnapshotsDocument> {
    if (!session) {
      const ownedSession = await this.accountsModel.db.startSession();
      try {
        return await ownedSession.withTransaction(() =>
          this.create(userId, accountId, createSnapshotDto, ownedSession),
        );
      } finally {
        await ownedSession.endSession();
      }
    }
    const locked = await this.accountsModel.updateOne(
      { _id: accountId, ...personalBudget(userId) },
      { $inc: { mutationVersion: 1 } },
      { session },
    );
    if (!locked.matchedCount)
      throw new NotFoundException(`Account ${accountId} not found.`);
    const createDtoInstance = plainToInstance(
      CreateAccountSnapshotDto,
      createSnapshotDto,
    );
    const foundAccountId = await this.ensureAccountExists(
      userId,
      accountId,
      session,
    );

    const existingEntity = await this.snapshotsModel
      .findOne({ accountId: foundAccountId, date: createDtoInstance.date })
      .session(session ?? null)
      .lean()
      .exec();

    if (existingEntity) {
      throw new ConflictException(
        `Snapshot for account ${accountId} on ${createSnapshotDto.date.toISOString()} already exists.`,
      );
    }

    const [snapshot] = await this.snapshotsModel.create(
      [{ accountId: foundAccountId, ...createDtoInstance }],
      { session },
    );
    return snapshot;
  }

  async recalculateSnapshotsFromDate(
    userId: string,
    accountId: string,
    queryDto: UpdateAccountSnapshotQueryDto,
    updateDto: UpdateAccountSnapshotDto,
    session?: ClientSession,
  ) {
    const entity = await this.snapshotsModel
      .findOne({
        accountId: new Types.ObjectId(accountId),
        date: { $lte: queryDto.date },
      })
      .sort({ date: -1, createdAt: -1 })
      .session(session ?? null)
      .lean()
      .exec();

    if (!entity) {
      throw new NotFoundException(
        `Snapshot for date ${queryDto.date} not found.`,
      );
    }

    const foundAccountId = await this.ensureAccountExists(
      userId,
      accountId,
      session,
    );

    await this.snapshotsModel.updateMany(
      { accountId: foundAccountId, date: { $gte: entity.date } },
      [
        {
          $set: {
            amount: { $round: [{ $add: ['$amount', updateDto.amount] }, 2] },
          },
        },
      ],
      { updatePipeline: true, runValidators: true, session },
    );
  }

  async deleteAllByAccountId(
    userId: string,
    accountId: string,
    session?: ClientSession,
  ) {
    const foundAccountId = await this.ensureAccountExists(
      userId,
      accountId,
      session,
    );
    await this.snapshotsModel.deleteMany(
      { accountId: foundAccountId },
      { session },
    );
  }

  // TODO Параметры сортировки и пагинации
  async findAllByAccounts(
    accountIds: Types.ObjectId[],
    query?: { toDate?: string },
  ) {
    const filter: {
      accountId: { $in: Types.ObjectId[] };
      date?: { $lte: Date };
    } = { accountId: { $in: accountIds } };
    if (query?.toDate) {
      filter.date = { $lte: new Date(query.toDate) };
    }

    return this.snapshotsModel.aggregate<{
      _id: Types.ObjectId;
      documents: AccountSnapshotsDocument[];
    }>([
      { $match: filter },
      {
        $group: {
          _id: '$accountId',
          documents: {
            $topN: {
              n: 20,
              sortBy: { date: -1, createdAt: -1 },
              output: '$$ROOT',
            },
          },
        },
      },
    ]);
  }

  private async ensureAccountExists(
    userId: string,
    accountId: string,
    session?: ClientSession,
  ) {
    const accountEntity = await this.accountsModel
      .exists({
        _id: accountId,
        ...personalBudget(new Types.ObjectId(userId)),
      })
      .session(session ?? null);

    if (!accountEntity) {
      throw new NotFoundException(
        `Account ${accountId} for user ${userId} not found.`,
      );
    }

    return accountEntity._id;
  }

  private async findAccounts(userId: string) {
    return this.accountsModel
      .find({ ...personalBudget(new Types.ObjectId(userId)) })
      .lean();
  }
}
