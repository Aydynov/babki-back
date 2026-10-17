import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  BudgetContext,
  budgetFilter,
} from '../../../common/budget/budget-context';
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
import { Account } from '../../accounts/schemas/accounts.schema';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { Transfer, TransferDocument } from '../schemas/transfer.schema';
import { activeTransactionFilter } from '../transactions/active-transaction.filter';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { transferResponse } from './transfer-response';

type TransferAccount = Account & { _id: Types.ObjectId };

@Injectable()
export class TransfersService {
  constructor(
    @InjectModel(Transfer.name) private readonly model: Model<TransferDocument>,
    private readonly snapshots: AccountsSnapshotsService,
    private readonly transactions: TransactionsService,
  ) {}

  async create(userId: string, dto: CreateTransferDto) {
    this.validateAccounts(dto);
    return this.inTransaction(userId, async (session) =>
      personalResponse(
        await this.createForBudget(
          personalBudget(userId),
          userId,
          dto,
          session,
        ),
      ),
    );
  }

  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: CreateTransferDto,
    session: ClientSession,
  ) {
    this.validateAccounts(dto, budget);
    await this.transactions.lockAccountsForBudget(
      budget,
      [dto.sourceAccountId, dto.destinationAccountId],
      session,
    );
    const date = new Date(dto.transactionDate);
    const source = await this.transactions.accountForCreate(
      budget,
      dto.sourceAccountId,
      date,
      session,
    );
    const destination = await this.transactions.accountForCreate(
      budget,
      dto.destinationAccountId,
      date,
      session,
    );
    this.validateAmounts(
      source.currency!,
      destination.currency!,
      dto.sourceAmount,
      dto.destinationAmount,
      budget,
    );
    const sourceAmount = this.amountForBudget(
      budget,
      dto.sourceAmount,
      source.currency!,
    );
    const destinationAmount = this.amountForBudget(
      budget,
      dto.destinationAmount,
      destination.currency!,
    );
    if (budget.ownerType === 'group') {
      const available = await this.snapshots.balanceForBudget(
        source,
        date,
        session,
      );
      if (available < sourceAmount)
        throw new BadRequestException('Insufficient source funds.');
    }
    const sourceSnapshot = await this.snapshots.prepareForBudget(
      source,
      date,
      session,
    );
    const destinationSnapshot = await this.snapshots.prepareForBudget(
      destination,
      date,
      session,
    );
    if (budget.ownerType === 'user' && sourceSnapshot.amount < sourceAmount)
      throw new BadRequestException('Insufficient source funds.');
    const [transfer] = await this.model.create(
      [
        {
          ...budgetFilter(budget),
          createdBy: new Types.ObjectId(actorId),
          transactionDate: dto.transactionDate,
          description: dto.description,
          source: {
            accountId: source._id,
            snapshotId: sourceSnapshot._id,
            amount: sourceAmount,
            currency: source.currency,
          },
          destination: {
            accountId: destination._id,
            snapshotId: destinationSnapshot._id,
            amount: destinationAmount,
            currency: destination.currency,
          },
        },
      ],
      { session },
    );
    const stored = transfer.toObject();
    await this.apply(
      source,
      destination,
      stored,
      -sourceAmount,
      destinationAmount,
      session,
    );
    return transferResponse(stored);
  }

  async findAll(userId: string, query: ListTransactionsQueryDto) {
    await this.transactions.ensureUserExists(userId);
    return personalResponse(
      await this.findAllForBudget(personalBudget(userId), query),
    );
  }

  async findAllForBudget(
    budget: BudgetContext,
    query: ListTransactionsQueryDto,
  ) {
    const { page, limit, skip } = getPagination(query);
    const { accountId, ...baseQuery } = query;
    const filter: Record<string, unknown> =
      this.transactions.buildFilterForBudget(budget, {
        ...(budget.ownerType === 'user' ? baseQuery : query),
        transactionType: 'transfer',
      });
    // Preserve the dedicated personal endpoint's existing account-filter policy.
    if (budget.ownerType === 'user' && accountId) {
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
    return { items: items.map(transferResponse), total, page, limit };
  }

  async findOne(userId: string, id: string) {
    return personalResponse(
      await this.findOneForBudget(personalBudget(userId), id),
    );
  }

  async findOneForBudget(budget: BudgetContext, id: string) {
    return transferResponse(await this.getStoredForBudget(budget, id));
  }

  async getStoredForBudget(
    budget: BudgetContext,
    id: string,
    session?: ClientSession,
  ) {
    const transfer = await this.model
      .findOne({ _id: id, ...budgetFilter(budget), ...activeTransactionFilter })
      .session(session ?? null)
      .lean()
      .exec();
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found.`);
    return transfer;
  }

  async update(userId: string, id: string, dto: UpdateTransferDto) {
    return this.inTransaction(userId, async (session) =>
      personalResponse(
        await this.updateForBudget(personalBudget(userId), id, dto, session),
      ),
    );
  }

  async updateForBudget(
    budget: BudgetContext,
    id: string,
    dto: UpdateTransferDto,
    session: ClientSession,
  ) {
    const transfer = await this.getStoredForBudget(budget, id, session);
    const [source, destination] = await this.lockTransferAccounts(
      budget,
      transfer,
      session,
    );
    const sourceAmount = this.amountForBudget(
      budget,
      dto.sourceAmount ?? transfer.source.amount,
      transfer.source.currency,
    );
    const destinationAmount = this.amountForBudget(
      budget,
      dto.destinationAmount ?? transfer.destination.amount,
      transfer.destination.currency,
    );
    this.validateAmounts(
      transfer.source.currency,
      transfer.destination.currency,
      dto.sourceAmount ?? transfer.source.amount,
      dto.destinationAmount ?? transfer.destination.amount,
      budget,
    );
    const extraDebit = this.amountForBudget(
      budget,
      sourceAmount - transfer.source.amount,
      transfer.source.currency,
    );
    if (budget.ownerType === 'user') {
      const snapshot = await this.snapshots.findByAccountId(
        String(budget.ownerId),
        String(source._id),
        transfer.transactionDate.toISOString(),
        session,
      );
      if (!snapshot || snapshot.amount < extraDebit)
        throw new BadRequestException('Insufficient source funds.');
    } else if (extraDebit > 0) {
      const available = await this.snapshots.balanceForBudget(
        source,
        transfer.transactionDate,
        session,
      );
      if (available < extraDebit)
        throw new BadRequestException('Insufficient source funds.');
    }
    // The group rebuild must read the replacement amounts from the ledger.
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, ...budgetFilter(budget), ...activeTransactionFilter },
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
    await this.apply(
      source,
      destination,
      transfer,
      -extraDebit,
      destinationAmount - transfer.destination.amount,
      session,
    );
    return transferResponse(updated);
  }

  async delete(userId: string, id: string) {
    return this.inTransaction(userId, (session) =>
      this.deleteForBudget(personalBudget(userId), userId, id, session),
    );
  }

  async deleteForBudget(
    budget: BudgetContext,
    actorId: string,
    id: string,
    session: ClientSession,
  ) {
    const transfer = await this.getStoredForBudget(budget, id, session);
    const [source, destination] = await this.lockTransferAccounts(
      budget,
      transfer,
      session,
    );
    const deleted = await this.model.findOneAndUpdate(
      { _id: id, ...budgetFilter(budget), ...activeTransactionFilter },
      {
        $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(actorId) },
      },
      { returnDocument: 'after', session },
    );
    if (!deleted) throw new NotFoundException(`Transfer ${id} not found.`);
    await this.apply(
      source,
      destination,
      transfer,
      transfer.source.amount,
      -transfer.destination.amount,
      session,
    );
    return null;
  }

  private async lockTransferAccounts(
    budget: BudgetContext,
    transfer: Transfer,
    session: ClientSession,
  ) {
    const sourceId = String(transfer.source.accountId);
    const destinationId = String(transfer.destination.accountId);
    await this.transactions.lockAccountsForBudget(
      budget,
      [sourceId, destinationId],
      session,
    );
    const source = await this.transactions.accountForBudget(
      budget,
      sourceId,
      session,
    );
    const destination = await this.transactions.accountForBudget(
      budget,
      destinationId,
      session,
    );
    return [source, destination] as const;
  }

  private validateAccounts(dto: CreateTransferDto, budget?: BudgetContext) {
    const source = dto.sourceAccountId;
    const destination = dto.destinationAccountId;
    if (
      source === destination ||
      (budget?.ownerType === 'group' &&
        source.toLowerCase() === destination.toLowerCase())
    )
      throw new BadRequestException('Transfer accounts must be different.');
  }

  private amountForBudget(
    budget: BudgetContext,
    amount: number,
    currency: string,
  ) {
    return budget.ownerType === 'group'
      ? normalizeMoney(amount, currency)
      : amount;
  }

  private validateAmounts(
    sourceCurrency: string,
    destinationCurrency: string,
    source: number,
    destination: number,
    budget: BudgetContext,
  ) {
    if (
      budget.ownerType === 'group' &&
      (!Number.isFinite(source) ||
        !Number.isFinite(destination) ||
        source <= 0 ||
        destination <= 0 ||
        normalizeMoney(source, sourceCurrency) <= 0 ||
        normalizeMoney(destination, destinationCurrency) <= 0)
    )
      throw new BadRequestException('Transfer amounts must be positive.');
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
    source: TransferAccount,
    destination: TransferAccount,
    transfer: Transfer,
    sourceDelta: number,
    destinationDelta: number,
    session: ClientSession,
  ) {
    await this.snapshots.applyForBudget(
      source,
      transfer.transactionDate,
      sourceDelta,
      session,
    );
    await this.snapshots.applyForBudget(
      destination,
      transfer.transactionDate,
      destinationDelta,
      session,
    );
  }

  private inTransaction<T>(
    userId: string,
    work: (session: ClientSession) => Promise<T>,
  ) {
    return this.transactions.runForBudget(personalBudget(userId), userId, work);
  }
}
