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
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { Account } from '../../accounts/schemas/accounts.schema';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { Transfer, TransferDocument } from '../schemas/transfer.schema';
import { activeTransactionFilter } from '../transactions/active-transaction.filter';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { transferResponse } from './transfer-response';
type TransferAccount = Account & {
  _id: Types.ObjectId;
};
@Injectable()
export class TransfersService {
  constructor(
    @InjectModel(Transfer.name)
    private readonly model: Model<TransferDocument>,
    private readonly snapshots: AccountsSnapshotsService,
    private readonly transactions: TransactionsService,
  ) {}
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
    {
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
  async findAllForBudget(
    budget: BudgetContext,
    query: ListTransactionsQueryDto,
  ) {
    const { page, limit, skip } = getPagination(query);
    const filter: Record<string, unknown> =
      this.transactions.buildFilterForBudget(budget, {
        ...query,
        transactionType: 'transfer',
      });
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
    if (extraDebit > 0) {
      const available = await this.snapshots.balanceForBudget(
        source,
        transfer.transactionDate,
        session,
      );
      if (available < extraDebit)
        throw new BadRequestException('Insufficient source funds.');
    }
    // The space rebuild must read the replacement amounts from the ledger.
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
  private validateAccounts(dto: CreateTransferDto, _budget?: BudgetContext) {
    const source = dto.sourceAccountId;
    const destination = dto.destinationAccountId;
    if (
      source === destination ||
      source.toLowerCase() === destination.toLowerCase()
    )
      throw new BadRequestException('Transfer accounts must be different.');
  }
  private amountForBudget(
    _budget: BudgetContext,
    amount: number,
    currency: string,
  ) {
    return normalizeMoney(amount, currency);
  }
  private validateAmounts(
    sourceCurrency: string,
    destinationCurrency: string,
    source: number,
    destination: number,
    _budget: BudgetContext,
  ) {
    if (
      !Number.isFinite(source) ||
      !Number.isFinite(destination) ||
      source <= 0 ||
      destination <= 0 ||
      normalizeMoney(source, sourceCurrency) <= 0 ||
      normalizeMoney(destination, destinationCurrency) <= 0
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
}
