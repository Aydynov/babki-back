import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BudgetContext, budgetFilter } from 'src/common/budget/budget-context';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { Account } from '../../accounts/schemas/accounts.schema';
import { Income, IncomeDocument } from '../schemas/income.schema';
import { TransactionOrigin } from '../schemas/transaction.schema';
import {
  FinancialChanges,
  FinancialTransaction,
  TransactionsService,
} from '../transactions/transactions.service';
import { CreateIncomeDto } from './dto/create-income.dto';
type IncomeCommand = Omit<CreateIncomeDto, 'source'> & {
  source?: string;
};
@Injectable()
export class IncomesService {
  constructor(
    @InjectModel(Income.name)
    private readonly incomeModel: Model<IncomeDocument>,
    private readonly snapshotsService: AccountsSnapshotsService,
    private readonly transactionsService: TransactionsService,
  ) {}
  async createForBudget(
    budget: BudgetContext,
    actorId: string,
    dto: IncomeCommand,
    session: ClientSession,
    origin?: TransactionOrigin,
    existingAccount?: Account & {
      _id: Types.ObjectId;
    },
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
    this.transactionsService.validateMoneyForBudget(budget, account, dto);
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
          currency: account.currency,
          ...{},
          ...(origin ? { origin } : {}),
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
  updateForBudget(
    budget: BudgetContext,
    income: FinancialTransaction,
    changes: FinancialChanges,
    session: ClientSession,
    account?: Account & {
      _id: Types.ObjectId;
    },
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
