import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { hasValidMoneyPrecision, normalizeMoney } from 'src/common/money/money';
import { getPagination } from '../../common/utils/pagination.util';
import {
  DebtTransaction,
  DebtTransactionDocument,
} from '../debt-transactions/schemas/debt-transaction.schema';
import { IncomesService } from '../transactions/incomes/incomes.service';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';
import { TransactionsService } from '../transactions/transactions/transactions.service';
import { ListDebtsQueryDto } from './dto/list-debts-query.dto';
import {
  CreateDebtCommand,
  RepayDebtCommand,
  UpdateDebtCommand,
} from './interfaces/debt-command.interface';
import { Debt, DebtDocument } from './schemas/debt.schema';
export type DebtRepaymentResult = {
  debt: Debt & {
    _id: Types.ObjectId;
  };
  repayment: DebtTransaction & {
    _id: Types.ObjectId;
  };
};
@Injectable()
export class DebtsService implements OnModuleInit {
  constructor(
    @InjectModel(Debt.name)
    private readonly debtModel: Model<DebtDocument>,
    @InjectModel(DebtTransaction.name)
    private readonly debtTransactionModel: Model<DebtTransactionDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly incomeService: IncomesService,
    private readonly transactionsService: TransactionsService,
  ) {}
  async onModuleInit() {
    await this.debtModel.createIndexes();
    await this.debtTransactionModel.createIndexes();
  }
  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: CreateDebtCommand,
    session: ClientSession,
  ) {
    const remainingAmount = dto.principalAmount;
    this.validateAmount(budget, dto.principalAmount, dto.currency);
    if (!hasValidMoneyPrecision(remainingAmount, dto.currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    this.validateAmounts(dto.principalAmount, remainingAmount);
    const [debt] = await this.debtModel.create(
      [
        {
          ...dto,
          ...budgetFilter(budget),
          createdBy: new Types.ObjectId(actorId),
          remainingAmount,
          ...{ status: 'active' },
        },
      ],
      { session },
    );
    return debt.toObject();
  }
  async listForBudget(
    budget: BudgetContext,
    query: ListDebtsQueryDto & {
      includeArchived?: boolean;
    },
  ) {
    const { page, limit, skip } = getPagination(query);
    const filter = {
      ...budgetFilter(budget),
      ...(!query.includeArchived ? { archivedAt: null } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
    };
    const [items, total] = await Promise.all([
      this.debtModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.debtModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
  getForBudget(budget: BudgetContext, debtId: string, session?: ClientSession) {
    return this.requireDebt(budget, debtId, session, false);
  }
  async updateForBudget(
    budget: BudgetContext,
    debtId: string,
    dto: UpdateDebtCommand,
    session: ClientSession,
  ) {
    const current = await this.requireDebt(budget, debtId, session, true);
    if ('remainingAmount' in dto || 'status' in dto)
      throw new BadRequestException(
        'Space debt remaining amount and status are managed by repayments.',
      );
    const principal = dto.principalAmount ?? current.principalAmount;
    const remaining =
      dto.principalAmount !== undefined
        ? principal
        : (dto.remainingAmount ?? current.remainingAmount);
    if (
      !hasValidMoneyPrecision(principal, current.currency) ||
      !hasValidMoneyPrecision(remaining, current.currency)
    )
      throw new BadRequestException('Amount exceeds currency precision.');
    this.validateAmounts(principal, remaining);
    if (dto.principalAmount !== undefined) {
      this.validateAmount(budget, principal, current.currency);
      if (
        await this.debtTransactionModel
          .exists({ debtId: current._id })
          .session(session)
      )
        throw new ConflictException(
          'Cannot change principal after repayment history.',
        );
    }
    const changes = {
      ...dto,
      ...(dto.principalAmount !== undefined
        ? { remainingAmount: principal }
        : {}),
    };
    return this.debtModel
      .findOneAndUpdate(
        { _id: debtId, ...budgetFilter(budget), archivedAt: null },
        changes,
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
  }
  async repayForBudget(
    budget: BudgetContext,
    actorId: string,
    debtId: string,
    dto: RepayDebtCommand,
    session: ClientSession,
  ): Promise<DebtRepaymentResult> {
    const current = await this.requireDebt(budget, debtId, session, true);
    if (current.status === 'closed')
      throw new BadRequestException(
        'Cannot record a repayment for a closed debt.',
      );
    if (dto.amount > current.remainingAmount)
      throw new BadRequestException(
        'Repayment amount cannot exceed the remaining debt amount.',
      );
    this.validateAmount(budget, dto.amount, current.currency);
    if (
      typeof dto.isIncome !== 'boolean' ||
      (!dto.isIncome && dto.accountId !== undefined)
    )
      throw new BadRequestException(
        'Invalid repayment income/account combination.',
      );
    const description = dto.description ?? `Погашение долга ${current.debtor}`;
    let incomeId: Types.ObjectId | undefined;
    if (dto.isIncome) {
      if (!dto.accountId)
        throw new BadRequestException(
          'Account is required for an income repayment.',
        );
      const command = {
        accountId: dto.accountId,
        amount: dto.amount,
        transactionDate: dto.repaymentDate,
        description,
        source: `Погашение долга ${current.debtor}`,
      };
      const origin = { type: 'debt' as const, id: new Types.ObjectId(debtId) };
      const income = await this.incomeService.createForBudget(
        budget,
        actorId,
        command,
        session,
        origin,
      );
      if (income.currency !== current.currency)
        throw new BadRequestException(
          'Debt and account currencies must match.',
        );
      incomeId = income._id;
    }
    const [history] = await this.debtTransactionModel.create(
      [
        {
          ...budgetFilter(budget),
          createdBy: new Types.ObjectId(actorId),
          debtId: current._id,
          transactionDate: dto.repaymentDate,
          amount: dto.amount,
          description,
          ...{
            isIncome: dto.isIncome,
            cancelledAt: null,
            ...(incomeId ? { incomeId } : {}),
          },
        },
      ],
      { session },
    );
    const remainingAmount = normalizeMoney(
      current.remainingAmount - dto.amount,
      current.currency,
    );
    const debt = await this.debtModel
      .findOneAndUpdate(
        {
          _id: debtId,
          ...budgetFilter(budget),
          archivedAt: null,
          status: current.status,
          remainingAmount: current.remainingAmount,
        },
        {
          remainingAmount,
          status: remainingAmount === 0 ? 'closed' : current.status,
        },
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
    if (!debt)
      throw new ConflictException('Debt state changed; retry the request.');
    return { debt, repayment: history.toObject() };
  }
  async cancelRepaymentForBudget(
    budget: BudgetContext,
    actorId: string,
    debtId: string,
    repaymentId: string,
    session: ClientSession,
  ): Promise<DebtRepaymentResult> {
    const current = await this.requireDebt(budget, debtId, session, true);
    const repayment = await this.debtTransactionModel
      .findOne({
        _id: repaymentId,
        debtId: current._id,
        ...budgetFilter(budget),
      })
      .session(session)
      .lean()
      .exec();
    if (!repayment) throw new NotFoundException('Repayment not found');
    if (repayment.cancelledAt)
      throw new ConflictException('Repayment already cancelled.');
    if (repayment.isIncome) {
      if (!(repayment.incomeId instanceof Types.ObjectId))
        throw new ConflictException('Repayment income is inconsistent.');
      const income = repayment.incomeId
        ? await this.transactionModel
            .findOne({ _id: repayment.incomeId, ...budgetFilter(budget) })
            .session(session)
            .lean()
            .exec()
        : null;
      if (
        !income ||
        income.deletedAt ||
        income.type !== 'income' ||
        !(income.accountId instanceof Types.ObjectId) ||
        income.origin?.type !== 'debt' ||
        !(income.origin.id instanceof Types.ObjectId) ||
        !income.origin.id.equals(current._id) ||
        income.amount !== repayment.amount ||
        income.currency !== current.currency ||
        !(income.transactionDate instanceof Date) ||
        !(repayment.transactionDate instanceof Date) ||
        income.transactionDate.getTime() !== repayment.transactionDate.getTime()
      )
        throw new ConflictException('Repayment income is inconsistent.');
      await this.transactionsService.deleteForBudget(
        budget,
        actorId,
        income,
        session,
      );
    } else if (repayment.isIncome !== false || repayment.incomeId) {
      throw new ConflictException('Repayment income is inconsistent.');
    }
    const cancelled = await this.debtTransactionModel
      .findOneAndUpdate(
        { _id: repayment._id, ...budgetFilter(budget), cancelledAt: null },
        {
          $set: {
            cancelledAt: new Date(),
            cancelledBy: new Types.ObjectId(actorId),
          },
        },
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
    if (!cancelled) throw new ConflictException('Repayment already cancelled.');
    const remainingAmount = normalizeMoney(
      current.remainingAmount + repayment.amount,
      current.currency,
    );
    if (remainingAmount > current.principalAmount)
      throw new ConflictException('Repayment balance is inconsistent.');
    const debt = await this.debtModel
      .findOneAndUpdate(
        {
          _id: current._id,
          ...budgetFilter(budget),
          archivedAt: null,
          remainingAmount: current.remainingAmount,
          status: current.status,
        },
        { remainingAmount, status: 'active' },
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
    if (!debt)
      throw new ConflictException('Debt state changed; retry the request.');
    return { debt, repayment: cancelled };
  }
  async removeForBudget(
    budget: BudgetContext,
    debtId: string,
    session: ClientSession,
  ) {
    const debt = await this.requireDebt(budget, debtId, session);
    const history = await this.debtTransactionModel
      .exists({ debtId: debt._id })
      .session(session);
    const income = await this.transactionModel
      .exists({ 'origin.type': 'debt', 'origin.id': debt._id })
      .session(session);
    if (history || income || debt.archivedAt)
      throw new ConflictException(
        'Cannot delete a debt with financial history; archive it instead.',
      );
    const deleted = await this.debtModel.findOneAndDelete(
      { _id: debtId, ...budgetFilter(budget), archivedAt: null },
      { session },
    );
    if (!deleted)
      throw new ConflictException('Debt state changed; retry the request.');
  }
  async archiveForBudget(
    budget: BudgetContext,
    debtId: string,
    session: ClientSession,
  ) {
    const archived = await this.debtModel.findOneAndUpdate(
      { _id: debtId, ...budgetFilter(budget), archivedAt: null },
      { $set: { archivedAt: new Date() } },
      { returnDocument: 'after', session },
    );
    if (!archived) throw this.notFound(budget, debtId);
  }
  private async requireDebt(
    budget: BudgetContext,
    debtId: string,
    session?: ClientSession,
    activeOnly = false,
  ) {
    const query = this.debtModel.findOne({
      _id: debtId,
      ...budgetFilter(budget),
      ...(activeOnly ? { archivedAt: null } : {}),
    });
    if (session && typeof query.session === 'function') query.session(session);
    const debt = await query.lean().exec();
    if (!debt) throw this.notFound(budget, debtId);
    return debt;
  }
  private notFound(_budget: BudgetContext, _debtId: string) {
    return new NotFoundException('Debt not found');
  }
  private validateAmount(
    budget: BudgetContext,
    amount: number,
    currency: string,
  ) {
    if (!hasValidMoneyPrecision(amount, currency))
      throw new BadRequestException('Amount exceeds currency precision.');
    if (normalizeMoney(amount, currency) <= 0)
      throw new BadRequestException('Amount must be positive.');
  }
  private validateAmounts(principalAmount: number, remainingAmount: number) {
    if (remainingAmount > principalAmount)
      throw new BadRequestException(
        'Remaining debt amount cannot exceed the principal amount.',
      );
  }
}
