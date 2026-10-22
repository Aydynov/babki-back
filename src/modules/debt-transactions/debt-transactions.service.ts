import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { getPagination } from 'src/common/utils/pagination.util';
import { Debt, DebtDocument } from '../debts/schemas/debt.schema';
import { ListDebtTransactionsQueryDto } from './dto/list-debt-transactions-query.dto';
import {
  DebtTransaction,
  DebtTransactionDocument,
} from './schemas/debt-transaction.schema';
@Injectable()
export class DebtTransactionsService {
  constructor(
    @InjectModel(DebtTransaction.name)
    private readonly debtTransactionModel: Model<DebtTransactionDocument>,
    @InjectModel(Debt.name)
    private readonly debtModel: Model<DebtDocument>,
  ) {}
  async listForBudget(
    budget: BudgetContext,
    debtId: string,
    query: ListDebtTransactionsQueryDto,
  ) {
    await this.ensureDebtExists(budget, debtId);
    const { page, limit, skip } = getPagination(query);
    const filter = {
      debtId: new Types.ObjectId(debtId),
      ...budgetFilter(budget),
    };
    const [items, total] = await Promise.all([
      this.debtTransactionModel
        .find(filter)
        .sort({ transactionDate: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.debtTransactionModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
  async getForBudget(
    budget: BudgetContext,
    debtId: string,
    repaymentId: string,
    session?: ClientSession,
  ) {
    await this.ensureDebtExists(budget, debtId, session);
    const query = this.debtTransactionModel.findOne({
      _id: repaymentId,
      debtId: new Types.ObjectId(debtId),
      ...budgetFilter(budget),
    });
    if (session) query.session(session);
    const row = await query.lean().exec();
    if (!row)
      throw new NotFoundException(
        `Debt transaction ${repaymentId} for debt ${debtId} not found.`,
      );
    return row;
  }
  private async ensureDebtExists(
    budget: BudgetContext,
    debtId: string,
    session?: ClientSession,
  ) {
    const query = this.debtModel.exists({
      _id: debtId,
      ...budgetFilter(budget),
    });
    const found = session ? await query.session(session) : await query;
    if (!found) throw new NotFoundException(`Debt ${debtId} is not found.`);
  }
}
