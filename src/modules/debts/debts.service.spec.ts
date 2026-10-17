import { Connection, Model, Types } from 'mongoose';
import { DebtTransactionDocument } from '../debt-transactions/schemas/debt-transaction.schema';
import { IncomesService } from '../transactions/incomes/incomes.service';
import { UserDocument } from '../users/schemas/user.schema';
import { DebtDocument } from './schemas/debt.schema';
import { DebtsService } from './debts.service';
import { TransactionsService } from '../transactions/transactions/transactions.service';
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
  const debtTransactionModel = {
    create: jest.fn().mockResolvedValue([{ toObject: () => ({}) }]),
  };
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
    {} as TransactionsService,
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

describe('DebtsService shared budget rules', () => {
  const actorId = new Types.ObjectId().toHexString();
  const groupId = new Types.ObjectId();
  const debtId = new Types.ObjectId();
  const repaymentId = new Types.ObjectId();
  const incomeId = new Types.ObjectId();
  const budget = { ownerType: 'group' as const, ownerId: groupId };
  const session = {} as import('mongoose').ClientSession;
  const current = {
    _id: debtId,
    ownerType: 'group',
    ownerId: groupId,
    createdBy: new Types.ObjectId(actorId),
    debtor: 'Borrower',
    principalAmount: 100,
    remainingAmount: 70,
    currency: 'USD',
    status: 'active',
    archivedAt: null,
  };
  const query = (row: unknown) => ({
    session: jest.fn().mockReturnThis(),
    lean: () => ({ exec: async () => row }),
  });
  let debtModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let historyModel: {
    exists: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let transactionModel: { findOne: jest.Mock };
  let transactionsService: { deleteForBudget: jest.Mock };
  let service: DebtsService;

  beforeEach(() => {
    debtModel = {
      create: jest
        .fn()
        .mockImplementation(async ([row]: object[]) => [
          { toObject: () => row },
        ]),
      findOne: jest.fn().mockReturnValue(query(current)),
      findOneAndUpdate: jest.fn().mockReturnValue(query(current)),
    };
    historyModel = {
      exists: jest.fn().mockReturnValue({ session: async () => null }),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    transactionModel = { findOne: jest.fn() };
    transactionsService = { deleteForBudget: jest.fn() };
    service = new DebtsService(
      debtModel as unknown as Model<DebtDocument>,
      {} as Model<UserDocument>,
      historyModel as unknown as Model<DebtTransactionDocument>,
      transactionModel as unknown as Model<TransactionDocument>,
      {} as IncomesService,
      {} as Connection,
      transactionsService as unknown as TransactionsService,
    );
  });

  it('creates a KWD minor-unit group debt with server-owned amounts/status and no personal owner', async () => {
    const debt = await service.createForBudget(
      budget,
      actorId,
      {
        debtor: 'Borrower',
        currency: 'KWD',
        principalAmount: 0.001,
        remainingAmount: 0,
        status: 'closed',
      },
      session,
    );
    expect(debt).toMatchObject({
      ownerType: 'group',
      ownerId: groupId,
      createdBy: new Types.ObjectId(actorId),
      principalAmount: 0.001,
      remainingAmount: 0.001,
      status: 'active',
    });
    expect(debt).not.toHaveProperty('userId');
    expect(debtModel.create).toHaveBeenCalledWith(expect.any(Array), {
      session,
    });
  });

  it.each([{ remainingAmount: 2 }, { status: 'closed' as const }])(
    'rejects manual group accounting updates %p even from a trusted caller',
    async (changes) => {
      await expect(
        service.updateForBudget(budget, String(debtId), changes, session),
      ).rejects.toMatchObject({ status: 400 });
      expect(debtModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('freezes principal after any history, including cancelled records', async () => {
    historyModel.exists.mockReturnValue({
      session: async () => ({ _id: repaymentId, cancelledAt: new Date() }),
    });
    await expect(
      service.updateForBudget(
        budget,
        String(debtId),
        { principalAmount: 120 },
        session,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(debtModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(historyModel.exists).toHaveBeenCalledWith({ debtId });
  });

  it('changes principal and remaining together before history', async () => {
    await service.updateForBudget(
      budget,
      String(debtId),
      { principalAmount: 120 },
      session,
    );
    expect(debtModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'group',
        ownerId: groupId,
        archivedAt: null,
      }),
      { principalAmount: 120, remainingAmount: 120 },
      expect.objectContaining({ session, runValidators: true }),
    );
  });

  it('rejects foreign repayment ownership before resolving any income', async () => {
    historyModel.findOne.mockReturnValue(query(null));
    await expect(
      service.cancelRepaymentForBudget(
        budget,
        actorId,
        String(debtId),
        String(repaymentId),
        session,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(historyModel.findOne).toHaveBeenCalledWith({
      _id: String(repaymentId),
      debtId,
      ownerType: 'group',
      ownerId: groupId,
    });
    expect(transactionModel.findOne).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'deleted',
    'foreign origin',
    'wrong amount',
    'wrong currency',
    'wrong date',
    'malformed link',
  ])(
    'rejects %s linked income without any cancellation writes',
    async (corruption) => {
      historyModel.findOne.mockReturnValue(
        query({
          _id: repaymentId,
          debtId,
          isIncome: true,
          incomeId: corruption === 'malformed link' ? 'bad-id' : incomeId,
          amount: 30,
          transactionDate: new Date('2026-09-21'),
          cancelledAt: null,
        }),
      );
      const income = {
        _id: incomeId,
        type: 'income',
        accountId: new Types.ObjectId(),
        amount: corruption === 'wrong amount' ? 31 : 30,
        currency: corruption === 'wrong currency' ? 'EUR' : 'USD',
        transactionDate: new Date(
          corruption === 'wrong date' ? '2026-09-22' : '2026-09-21',
        ),
        origin: {
          type: 'debt',
          id: corruption === 'foreign origin' ? new Types.ObjectId() : debtId,
        },
        ...(corruption === 'deleted' ? { deletedAt: new Date() } : {}),
      };
      transactionModel.findOne.mockReturnValue(
        query(corruption === 'missing' ? null : income),
      );
      await expect(
        service.cancelRepaymentForBudget(
          budget,
          actorId,
          String(debtId),
          String(repaymentId),
          session,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(transactionsService.deleteForBudget).not.toHaveBeenCalled();
      expect(historyModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(debtModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
});
