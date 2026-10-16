import {
  personalBudget,
  personalResponse,
} from 'src/common/utils/personal-budget.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasValidMoneyPrecision } from 'src/common/money/money';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { Account } from '../../accounts/schemas/accounts.schema';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import {
  FinancialChanges,
  FinancialTransaction,
  TransactionsService,
} from '../transactions/transactions.service';
import { CreateIncomeDto } from './dto/create-income.dto';
import { Income, IncomeDocument } from '../schemas/income.schema';
import { TransactionOrigin } from '../schemas/transaction.schema';
import { UpdateIncomeDto } from './dto/update-income.dto';

type IncomeCommand = Omit<CreateIncomeDto, 'source'> & { source?: string };

@Injectable()
export class IncomesService {
  constructor(
    @InjectModel(Income.name)
    private readonly incomeModel: Model<IncomeDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async create(
    userId: string,
    dto: CreateIncomeDto,
    session?: ClientSession,
    origin?: TransactionOrigin,
  ) {
    const budget = personalBudget(userId);
    return this.transactionsService.runForBudget(
      budget,
      userId,
      async (activeSession) =>
        personalResponse(
          await this.createForBudget(
            budget,
            userId,
            dto,
            activeSession,
            origin,
          ),
        ),
      session,
    );
  }

  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: IncomeCommand,
    session: ClientSession,
    origin?: TransactionOrigin,
    existingAccount?: Account & { _id: Types.ObjectId },
  ) {
    const date = new Date(dto.transactionDate);
    const account =
      existingAccount ??
      (await this.transactionsService.accountForCreate(
        budget,
        dto.accountId,
        date,
        session,
      ));
    if (
      budget.ownerType === 'user' &&
      !hasValidMoneyPrecision(dto.amount, account.currency!)
    )
      throw new BadRequestException('Amount exceeds currency precision.');
    await this.transactionsService.lockAccountsForBudget(
      budget,
      [account._id.toString()],
      session,
    );
    const snapshot = await this.snapshotsService.prepareForBudget(
      account,
      date,
      session,
    );
    if (!snapshot)
      throw new NotFoundException(
        `Snapshot for account ${account._id.toString()} not found.`,
      );
    const [income] = await this.incomeModel.create(
      [
        {
          ...budgetFilter(budget),
          createdBy: new Types.ObjectId(actorId),
          accountId: account._id,
          snapshotId: snapshot._id,
          amount: dto.amount,
          transactionDate: date,
          description: dto.description,
          ...(budget.ownerType === 'user'
            ? { source: dto.source, currency: account.currency, origin }
            : {}),
        },
      ],
      { session },
    );
    await this.snapshotsService.applyForBudget(
      account,
      date,
      dto.amount,
      session,
    );
    return income.toObject();
  }

  findAll(userId: string, query: ListTransactionsQueryDto) {
    return this.transactionsService.findAll(userId, query, this.incomeModel);
  }

  findRevenue(userId: string, query: ListTransactionsQueryDto) {
    return this.transactionsService.findRevenue(
      userId,
      query,
      this.incomeModel,
    );
  }

  findOne(userId: string, incomeId: string) {
    return this.transactionsService.findOne(userId, incomeId, this.incomeModel);
  }

  async update(userId: string, transactionId: string, dto: UpdateIncomeDto) {
    const budget = personalBudget(userId);
    return this.transactionsService.runForBudget(
      budget,
      userId,
      async (session) => {
        const income = await this.transactionsService.findOneForBudget(
          budget,
          transactionId,
          undefined,
          session,
          this.incomeModel,
        );
        if (
          dto.amount !== undefined &&
          (!income.currency ||
            !hasValidMoneyPrecision(dto.amount, income.currency))
        )
          throw new BadRequestException('Amount exceeds currency precision.');
        const changes = Object.fromEntries(
          Object.entries({
            amount: dto.amount,
            description: dto.description,
            source: dto.source,
          }).filter(([, value]) => value !== undefined),
        );
        return personalResponse(
          await this.updateForBudget(budget, income, changes, session),
        );
      },
    );
  }
  updateForBudget(
    budget: BudgetContext,
    income: FinancialTransaction,
    changes: FinancialChanges,
    session: ClientSession,
    account?: Account & { _id: Types.ObjectId },
  ) {
    return this.transactionsService.updateForBudget(
      budget,
      income,
      changes,
      session,
      this.incomeModel,
      false,
      account,
    );
  }
}
