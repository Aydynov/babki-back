import { Connection, Model, Types } from 'mongoose';
import { DebtTransactionDocument } from '../debt-transactions/schemas/debt-transaction.schema';
import { IncomesService } from '../transactions/incomes/incomes.service';
import { UserDocument } from '../users/schemas/user.schema';
import { DebtDocument } from './schemas/debt.schema';
import { DebtsService } from './debts.service';
import { TransactionDocument } from '../transactions/schemas/transaction.schema';

describe('DebtsService transaction origin', () => {
  const userId = '507f1f77bcf86cd799439011';
  const debtId = '507f1f77bcf86cd799439012';
  const accountId = '507f1f77bcf86cd799439013';
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const debtModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const userModel = { exists: jest.fn() };
  const debtTransactionModel = { create: jest.fn() };
  const transactionModel = { exists: jest.fn() };
  const incomeService = { create: jest.fn() };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const service = new DebtsService(
    debtModel as unknown as Model<DebtDocument>,
    userModel as unknown as Model<UserDocument>,
    debtTransactionModel as unknown as Model<DebtTransactionDocument>,
    transactionModel as unknown as Model<TransactionDocument>,
    incomeService as unknown as IncomesService,
    connection as unknown as Connection,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
    debtModel.findOne.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          _id: new Types.ObjectId(debtId),
          debtor: 'Borrower',
          remainingAmount: 100,
          status: 'active',
          currency: 'RUB',
        }),
      }),
    });
    debtModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          _id: new Types.ObjectId(debtId),
          remainingAmount: 50,
          status: 'active',
        }),
      }),
    });
  });

  it('marks generated repayment income with its debt origin', async () => {
    incomeService.create.mockResolvedValue({ currency: 'RUB' });
    await service.repay(userId, debtId, {
      accountId,
      amount: 50,
      repaymentDate: '2026-09-21',
      isIncome: true,
    });

    expect(incomeService.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ amount: 50 }),
      session,
      { type: 'debt', id: new Types.ObjectId(debtId) },
    );
  });
});
