import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import { getPagination } from '../../common/utils/pagination.util';
import { IncomesService } from '../transactions/incomes/incomes.service';
import {
  DebtTransaction,
  DebtTransactionDocument,
} from '../debt-transactions/schemas/debt-transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateDebtDto } from './dto/create-debt.dto';
import { ListDebtsQueryDto } from './dto/list-debts-query.dto';
import { RepayDebtDto } from './dto/repay-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { Debt, DebtDocument } from './schemas/debt.schema';
import {
  Transaction,
  TransactionDocument,
} from '../transactions/schemas/transaction.schema';

@Injectable()
export class DebtsService {
  constructor(
    @InjectModel(Debt.name) private readonly debtModel: Model<DebtDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(DebtTransaction.name)
    private readonly debtTransactionModel: Model<DebtTransactionDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly incomeService: IncomesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(userId: string, createDebtDto: CreateDebtDto) {
    const foundUserId = await this.ensureUserExists(userId);
    this.validateAmounts(
      createDebtDto.principalAmount,
      createDebtDto.remainingAmount,
    );

    const debt = await this.debtModel.create({
      userId: foundUserId,
      ...createDebtDto,
    });

    return debt.toObject();
  }

  async findAll(
    userId: string,
    query: ListDebtsQueryDto,
  ): Promise<PaginatedResponse<Debt>> {
    const foundUserId = await this.ensureUserExists(userId);

    const { page, limit, skip } = getPagination(query);
    const filter: {
      userId: Types.ObjectId;
      archivedAt: null;
      status?: 'active' | 'closed';
    } = { userId: foundUserId, archivedAt: null };

    if (query.status) {
      filter.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.debtModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.debtModel.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }

  async findOne(userId: string, debtId: string) {
    const foundUserId = await this.ensureUserExists(userId);

    const debt = await this.debtModel
      .findOne({ _id: debtId, userId: foundUserId, archivedAt: null })
      .lean()
      .exec();

    if (!debt) {
      throw new NotFoundException(
        `Debt ${debtId} for user ${userId} not found.`,
      );
    }

    return debt;
  }

  // TODO There may be a discrepancy between the data in the transactions and the current document
  async update(userId: string, debtId: string, updateDebtDto: UpdateDebtDto) {
    const foundUserId = await this.ensureUserExists(userId);

    const currentDebt = await this.debtModel
      .findOne({ _id: debtId, userId: foundUserId })
      .lean()
      .exec();

    if (!currentDebt) {
      throw new NotFoundException(
        `Debt ${debtId} for user ${userId} not found.`,
      );
    }

    const principal =
      updateDebtDto.principalAmount ?? currentDebt.principalAmount;
    const remaining =
      updateDebtDto.remainingAmount ?? currentDebt.remainingAmount;

    this.validateAmounts(principal, remaining);

    return this.debtModel
      .findOneAndUpdate(
        { _id: debtId, userId: foundUserId, archivedAt: null },
        updateDebtDto,
        {
          returnDocument: 'after',
          runValidators: true,
        },
      )
      .lean()
      .exec();
  }

  async repay(userId: string, debtId: string, repayDebtDto: RepayDebtDto) {
    const foundUserId = await this.ensureUserExists(userId);

    const currentDebt = await this.debtModel
      .findOne({ _id: debtId, userId: foundUserId, archivedAt: null })
      .lean()
      .exec();

    if (!currentDebt) {
      throw new NotFoundException(
        `Debt ${debtId} for user ${userId} not found.`,
      );
    }

    if (currentDebt.status === 'closed') {
      throw new BadRequestException(
        'Cannot record a repayment for a closed debt.',
      );
    }

    if (repayDebtDto.amount > currentDebt.remainingAmount) {
      throw new BadRequestException(
        'Repayment amount cannot exceed the remaining debt amount.',
      );
    }

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        await this.debtTransactionModel.create(
          [
            {
              userId: new Types.ObjectId(userId),
              debtId: new Types.ObjectId(debtId),
              transactionDate: repayDebtDto.repaymentDate,
              amount: repayDebtDto.amount,
              description: repayDebtDto.description,
            },
          ],
          { session },
        );
        if (repayDebtDto.isIncome) {
          await this.incomeService.create(
            userId,
            {
              amount: repayDebtDto.amount,
              transactionDate: repayDebtDto.repaymentDate,
              description: repayDebtDto.description,
              source: `Погашение долга ${currentDebt.debtor}`,
            },
            session,
            { type: 'debt', id: new Types.ObjectId(debtId) },
          );
        }

        const remainingAmount =
          Math.round(
            (currentDebt.remainingAmount - repayDebtDto.amount) * 100,
          ) / 100;
        const status = remainingAmount === 0 ? 'closed' : currentDebt.status;

        const debt = await this.debtModel
          .findOneAndUpdate(
            { _id: debtId, userId: foundUserId, archivedAt: null },
            { remainingAmount, status },
            { returnDocument: 'after', runValidators: true, session },
          )
          .lean()
          .exec();

        if (!debt) {
          throw new NotFoundException(
            `Debt ${debtId} for user ${userId} not found.`,
          );
        }

        return debt;
      });
    } finally {
      await session.endSession();
    }
  }

  async remove(userId: string, debtId: string) {
    const foundUserId = await this.ensureUserExists(userId);

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const debt = await this.debtModel
          .findOne({ _id: debtId, userId: foundUserId })
          .session(session)
          .lean()
          .exec();
        if (!debt) {
          throw new NotFoundException(
            `Debt ${debtId} for user ${userId} not found.`,
          );
        }
        const repayment = await this.debtTransactionModel
          .exists({ debtId: new Types.ObjectId(debtId) })
          .session(session);
        const generatedIncome = await this.transactionModel
          .exists({
            'origin.type': 'debt',
            'origin.id': new Types.ObjectId(debtId),
          })
          .session(session);
        if (repayment || generatedIncome) {
          throw new ConflictException(
            'Cannot delete a debt with financial history; archive it instead.',
          );
        }
        const deletedDebt = await this.debtModel.findOneAndDelete(
          { _id: debtId, userId: foundUserId, archivedAt: null },
          { session },
        );
        if (!deletedDebt) {
          throw new ConflictException('Debt state changed; retry the request.');
        }
      });
    } finally {
      await session.endSession();
    }
  }

  async archive(userId: string, debtId: string) {
    const foundUserId = await this.ensureUserExists(userId);
    const archived = await this.debtModel.findOneAndUpdate(
      { _id: debtId, userId: foundUserId, archivedAt: null },
      { $set: { archivedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!archived) {
      throw new NotFoundException(
        `Debt ${debtId} for user ${userId} not found.`,
      );
    }
  }

  private async ensureUserExists(userId: string) {
    const found = await this.userModel.exists({ _id: userId });

    if (!found) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return found._id;
  }

  // TODO Send the surplus to the current account/savings
  private validateAmounts(principalAmount: number, remainingAmount: number) {
    if (remainingAmount > principalAmount) {
      throw new BadRequestException(
        'Remaining debt amount cannot exceed the principal amount.',
      );
    }
  }
}
