import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AccountsSnapshotsService } from '../../accounts-snapshots/accounts-snapshots.service';
import { IncomeDocument } from '../schemas/income.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateIncomeDto } from './dto/create-income.dto';
import { IncomesService } from './incomes.service';

describe('IncomesService transaction origin', () => {
  const userId = '507f1f77bcf86cd799439011';
  const accountId = new Types.ObjectId('507f1f77bcf86cd799439012');
  const snapshotId = new Types.ObjectId('507f1f77bcf86cd799439013');
  const incomeModel = { create: jest.fn() };
  const snapshots = {
    findOrCreateByAccountId: jest.fn(),
    recalculateSnapshotsFromDate: jest.fn(),
  };
  const transactions = {
    ensureUserExists: jest.fn(),
    lockAccounts: jest.fn(),
  };
  const service = new IncomesService(
    incomeModel as unknown as Model<IncomeDocument>,
    snapshots as unknown as AccountsSnapshotsService,
    transactions as unknown as TransactionsService,
    {} as Connection,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transactions.ensureUserExists.mockResolvedValue({
      userId: new Types.ObjectId(userId),
      accountId,
    });
    snapshots.findOrCreateByAccountId.mockResolvedValue({
      _id: snapshotId,
      accountId,
    });
    incomeModel.create.mockResolvedValue([
      { toJSON: () => ({ _id: new Types.ObjectId() }) },
    ]);
  });

  it('persists an internal transaction origin', async () => {
    const session = {} as ClientSession;
    const dto: CreateIncomeDto = {
      amount: 50,
      transactionDate: '2026-09-21',
    };
    const origin = {
      type: 'debt' as const,
      id: new Types.ObjectId('507f1f77bcf86cd799439014'),
    };

    await (
      service.create as unknown as (
        userId: string,
        dto: CreateIncomeDto,
        session: ClientSession,
        origin: typeof origin,
      ) => Promise<unknown>
    )(userId, dto, session, origin);

    expect(incomeModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ origin })],
      { session },
    );
  });
});
