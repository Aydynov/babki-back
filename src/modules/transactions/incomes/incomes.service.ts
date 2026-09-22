import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateIncomeDto } from './dto/create-income.dto';
import { Income, IncomeDocument } from '../schemas/income.schema';
import { TransactionOrigin } from '../schemas/transaction.schema';
import { UpdateIncomeDto } from './dto/update-income.dto';
import { activeTransactionFilter } from '../transactions/active-transaction.filter';

@Injectable()
export class IncomesService {
  constructor(
    @InjectModel(Income.name)
    private readonly incomeModel: Model<IncomeDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionsService: TransactionsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    userId: string,
    createIncomeDto: CreateIncomeDto,
    session?: ClientSession,
    origin?: TransactionOrigin,
  ) {
    if (session)
      return this._doCreate(userId, createIncomeDto, session, origin);
    const s = await this.connection.startSession();
    try {
      return await s.withTransaction(() =>
        this._doCreate(userId, createIncomeDto, s, origin),
      );
    } finally {
      await s.endSession();
    }
  }

  private async _doCreate(
    userId: string,
    createIncomeDto: CreateIncomeDto,
    session: ClientSession,
    origin?: TransactionOrigin,
  ) {
    const foundIds = await this.transactionsService.ensureUserExists(
      userId,
      'balance',
      session,
    );
    await this.transactionsService.lockAccounts(
      userId,
      [foundIds.accountId.toString()],
      session,
    );
    const foundSnapshot = await this.snapshotsService.findOrCreateByAccountId(
      userId,
      foundIds.accountId.toString(),
      createIncomeDto.transactionDate,
      session,
    );

    if (!foundSnapshot) {
      throw new NotFoundException(
        `Snapshot for account ${foundIds.accountId.toString()} not found.`,
      );
    }

    const [createdIncome] = await this.incomeModel.create(
      [
        {
          ...personalBudget(foundIds.userId),
          createdBy: foundIds.userId,
          accountId: foundIds.accountId,
          snapshotId: foundSnapshot._id,
          ...createIncomeDto,
          origin,
        },
      ],
      { session },
    );
    await this.snapshotsService.recalculateSnapshotsFromDate(
      userId,
      foundSnapshot.accountId.toString(),
      { date: createIncomeDto.transactionDate },
      { amount: createIncomeDto.amount },
      session,
    );

    return personalResponse(createdIncome.toJSON());
  }

  async findAll(userId: string, query: ListTransactionsQueryDto) {
    return this.transactionsService.findAll(userId, query, this.incomeModel);
  }

  async findRevenue(userId: string, query: ListTransactionsQueryDto) {
    return this.transactionsService.findRevenue(
      userId,
      query,
      this.incomeModel,
    );
  }

  async findOne(userId: string, incomeId: string) {
    return this.transactionsService.findOne(userId, incomeId, this.incomeModel);
  }

  async update(
    userId: string,
    transactionId: string,
    updateIncomeDto: UpdateIncomeDto,
  ) {
    const updatePayload = Object.fromEntries(
      Object.entries({
        amount: updateIncomeDto.amount,
        description: updateIncomeDto.description,
        source: updateIncomeDto.source,
      }).filter(([, value]) => value !== undefined),
    );

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const income = await this.transactionsService.findOne(
          userId,
          transactionId,
          this.incomeModel,
          session,
        );

        if (!income) {
          throw new NotFoundException(`Income ${transactionId} not found`);
        }

        await this.transactionsService.lockAccounts(
          userId,
          [income.accountId.toString()],
          session,
        );
        if (updateIncomeDto.amount !== undefined) {
          const diffAmount = updateIncomeDto.amount - income.amount;
          await this.snapshotsService.recalculateSnapshotsFromDate(
            userId,
            income.accountId.toString(),
            { date: income.transactionDate.toISOString() },
            { amount: diffAmount },
            session,
          );
        }

        const updatedIncome = await this.incomeModel
          .findOneAndUpdate(
            {
              _id: transactionId,
              ...personalBudget(new Types.ObjectId(userId)),
              ...activeTransactionFilter,
            },
            { $set: updatePayload },
            {
              returnDocument: 'after',
              runValidators: true,
              session,
            },
          )
          .lean();

        if (!updatedIncome) {
          throw new NotFoundException(
            `Income ${transactionId} for user ${userId} not found.`,
          );
        }

        return personalResponse(updatedIncome);
      });
    } finally {
      await session.endSession();
    }
  }
}
