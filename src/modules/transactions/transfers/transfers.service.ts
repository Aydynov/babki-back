import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  hasValidMoneyPrecision,
  normalizeMoney,
} from '../../../common/money/money';
import { getPagination } from '../../../common/utils/pagination.util';
import {
  personalBudget,
  personalResponse,
} from '../../../common/utils/personal-budget.util';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { Transfer, TransferDocument } from '../schemas/transfer.schema';
import { activeTransactionFilter } from '../transactions/active-transaction.filter';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';

@Injectable()
export class TransfersService {
  constructor(
    @InjectModel(Transfer.name) private readonly model: Model<TransferDocument>,
    private readonly snapshots: AccountsSnapshotsService,
    private readonly transactions: TransactionsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(userId: string, dto: CreateTransferDto) {
    if (dto.sourceAccountId === dto.destinationAccountId)
      throw new BadRequestException('Transfer accounts must be different.');
    return this.inTransaction(async (session) => {
      await this.transactions.lockAccounts(
        userId,
        [dto.sourceAccountId, dto.destinationAccountId],
        session,
      );
      const source = await this.transactions.resolveActiveAccount(
        userId,
        dto.sourceAccountId,
        session,
      );
      const destination = await this.transactions.resolveActiveAccount(
        userId,
        dto.destinationAccountId,
        session,
      );
      this.validateAmounts(
        source.account.currency!,
        destination.account.currency!,
        dto.sourceAmount,
        dto.destinationAmount,
      );
      const sourceSnapshot = await this.snapshots.findOrCreateByAccountId(
        userId,
        dto.sourceAccountId,
        dto.transactionDate,
        session,
      );
      const destinationSnapshot = await this.snapshots.findOrCreateByAccountId(
        userId,
        dto.destinationAccountId,
        dto.transactionDate,
        session,
      );
      if (sourceSnapshot.amount < dto.sourceAmount)
        throw new BadRequestException('Insufficient source funds.');
      const [transfer] = await this.model.create(
        [
          {
            ...personalBudget(source.userId),
            createdBy: source.userId,
            transactionDate: dto.transactionDate,
            description: dto.description,
            source: {
              accountId: source.account._id,
              snapshotId: sourceSnapshot._id,
              amount: dto.sourceAmount,
              currency: source.account.currency,
            },
            destination: {
              accountId: destination.account._id,
              snapshotId: destinationSnapshot._id,
              amount: dto.destinationAmount,
              currency: destination.account.currency,
            },
          },
        ],
        { session },
      );
      await this.apply(
        userId,
        transfer.toObject(),
        -dto.sourceAmount,
        dto.destinationAmount,
        session,
      );
      return this.response(transfer.toObject());
    });
  }

  async findAll(userId: string, query: ListTransactionsQueryDto) {
    const found = await this.transactions.ensureUserExists(userId);
    const { page, limit, skip } = getPagination(query);
    const { accountId, ...baseQuery } = query;
    const filter: Record<string, unknown> = {
      ...this.transactions.buildFilter(found.userId, {
        ...baseQuery,
        transactionType: 'transfer',
      }),
    };
    if (accountId) {
      const id = new Types.ObjectId(accountId);
      filter.$or = [
        { 'source.accountId': id },
        { 'destination.accountId': id },
      ];
    }
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ transactionDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter),
    ]);
    return {
      items: items.map((item) => this.response(item)),
      total,
      page,
      limit,
    };
  }

  async findOne(userId: string, id: string) {
    return this.response(await this.findStored(userId, id));
  }

  private async findStored(
    userId: string,
    id: string,
    session?: ClientSession,
  ) {
    const transfer = await this.model
      .findOne({
        _id: id,
        ...personalBudget(userId),
        ...activeTransactionFilter,
      })
      .session(session ?? null)
      .lean()
      .exec();
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found.`);
    return transfer;
  }

  async update(userId: string, id: string, dto: UpdateTransferDto) {
    return this.inTransaction(async (session) => {
      const transfer = await this.findStored(userId, id, session);
      const sourceId = transfer.source.accountId.toString();
      const destinationId = transfer.destination.accountId.toString();
      await this.transactions.lockAccounts(
        userId,
        [sourceId, destinationId],
        session,
      );
      const sourceAmount = dto.sourceAmount ?? transfer.source.amount;
      const destinationAmount =
        dto.destinationAmount ?? transfer.destination.amount;
      this.validateAmounts(
        transfer.source.currency,
        transfer.destination.currency,
        sourceAmount,
        destinationAmount,
      );
      const sourceSnapshot = await this.snapshots.findByAccountId(
        userId,
        sourceId,
        transfer.transactionDate.toISOString(),
        session,
      );
      const extraDebit = sourceAmount - transfer.source.amount;
      if (!sourceSnapshot || sourceSnapshot.amount < extraDebit)
        throw new BadRequestException('Insufficient source funds.');
      await this.apply(
        userId,
        transfer,
        -extraDebit,
        destinationAmount - transfer.destination.amount,
        session,
      );
      const updated = await this.model
        .findOneAndUpdate(
          { _id: id, ...personalBudget(userId), ...activeTransactionFilter },
          {
            $set: {
              'source.amount': sourceAmount,
              'destination.amount': destinationAmount,
              ...(dto.description !== undefined
                ? { description: dto.description }
                : {}),
            },
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean()
        .exec();
      if (!updated) throw new NotFoundException(`Transfer ${id} not found.`);
      return this.response(updated);
    });
  }

  async delete(userId: string, id: string) {
    return this.inTransaction(async (session) => {
      const transfer = await this.findStored(userId, id, session);
      await this.transactions.lockAccounts(
        userId,
        [
          transfer.source.accountId.toString(),
          transfer.destination.accountId.toString(),
        ],
        session,
      );
      const deleted = await this.model.findOneAndUpdate(
        { _id: id, ...personalBudget(userId), ...activeTransactionFilter },
        {
          $set: {
            deletedAt: new Date(),
            deletedBy: new Types.ObjectId(userId),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!deleted) throw new NotFoundException(`Transfer ${id} not found.`);
      await this.apply(
        userId,
        transfer,
        transfer.source.amount,
        -transfer.destination.amount,
        session,
      );
      return null;
    });
  }

  private validateAmounts(
    sourceCurrency: string,
    destinationCurrency: string,
    source: number,
    destination: number,
  ) {
    if (
      !hasValidMoneyPrecision(source, sourceCurrency) ||
      !hasValidMoneyPrecision(destination, destinationCurrency)
    )
      throw new BadRequestException('Amount exceeds currency precision.');
    if (
      sourceCurrency === destinationCurrency &&
      normalizeMoney(source, sourceCurrency) !==
        normalizeMoney(destination, destinationCurrency)
    )
      throw new BadRequestException(
        'Same-currency transfer amounts must be equal.',
      );
  }

  private async apply(
    userId: string,
    transfer: Transfer,
    sourceDelta: number,
    destinationDelta: number,
    session: ClientSession,
  ) {
    await this.snapshots.recalculateSnapshotsFromDate(
      userId,
      transfer.source.accountId.toString(),
      { date: transfer.transactionDate.toISOString() },
      { amount: sourceDelta },
      session,
    );
    await this.snapshots.recalculateSnapshotsFromDate(
      userId,
      transfer.destination.accountId.toString(),
      { date: transfer.transactionDate.toISOString() },
      { amount: destinationDelta },
      session,
    );
  }

  private response<T extends Transfer>(transfer: T) {
    return personalResponse({
      ...transfer,
      effectiveRate: {
        baseCurrency: transfer.source.currency,
        quoteCurrency: transfer.destination.currency,
        rate: transfer.destination.amount / transfer.source.amount,
      },
    });
  }

  private async inTransaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}
