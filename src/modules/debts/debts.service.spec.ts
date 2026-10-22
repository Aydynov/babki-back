import { Model, Types } from 'mongoose';
import { DebtTransactionDocument } from '../debt-transactions/schemas/debt-transaction.schema';
import { IncomesService } from '../transactions/incomes/incomes.service';
import { DebtDocument } from './schemas/debt.schema';
import { DebtsService } from './debts.service';
import { TransactionsService } from '../transactions/transactions/transactions.service';
import { TransactionDocument } from '../transactions/schemas/transaction.schema';
describe('DebtsService shared budget rules', () => {
  const actorId = new Types.ObjectId().toHexString();
  const spaceId = new Types.ObjectId();
  const debtId = new Types.ObjectId();
  const repaymentId = new Types.ObjectId();
  const incomeId = new Types.ObjectId();
  const budget = { spaceId: spaceId };
  const session = {} as import('mongoose').ClientSession;
  const current = {
    _id: debtId,
    spaceId: spaceId,
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
    create: jest.Mock;
    exists: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let transactionModel: {
    findOne: jest.Mock;
  };
  let transactionsService: {
    deleteForBudget: jest.Mock;
  };
  const incomes = { createForBudget: jest.fn() };
  let service: DebtsService;
  beforeEach(() => {
    jest.clearAllMocks();
    incomes.createForBudget.mockResolvedValue({
      _id: incomeId,
      currency: 'USD',
    });
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
      create: jest
        .fn()
        .mockImplementation(async ([row]: object[]) => [
          { toObject: () => row },
        ]),
      exists: jest.fn().mockReturnValue({ session: async () => null }),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    transactionModel = { findOne: jest.fn() };
    transactionsService = { deleteForBudget: jest.fn() };
    service = new DebtsService(
      debtModel as unknown as Model<DebtDocument>,
      historyModel as unknown as Model<DebtTransactionDocument>,
      transactionModel as unknown as Model<TransactionDocument>,
      incomes as unknown as IncomesService,
      transactionsService as unknown as TransactionsService,
    );
  });
  it('creates a KWD minor-unit space debt with server-owned amounts/status and no personal owner', async () => {
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
      spaceId: spaceId,
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
  it('links a cash repayment to exactly one debt-origin income in the caller session', async () => {
    await service.repayForBudget(
      budget,
      actorId,
      String(debtId),
      {
        accountId: new Types.ObjectId().toString(),
        amount: 30,
        repaymentDate: '2026-09-21',
        isIncome: true,
      },
      session,
    );
    expect(incomes.createForBudget).toHaveBeenCalledTimes(1);
    expect(incomes.createForBudget).toHaveBeenCalledWith(
      budget,
      actorId,
      expect.objectContaining({ amount: 30 }),
      session,
      { type: 'debt', id: debtId },
    );
    expect(historyModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          ...budget,
          incomeId,
          amount: 30,
          createdBy: new Types.ObjectId(actorId),
        }),
      ],
      { session },
    );
    expect(debtModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ...budget, remainingAmount: 70 }),
      { remainingAmount: 40, status: 'active' },
      expect.objectContaining({ session }),
    );
  });
  it.each([{ remainingAmount: 2 }, { status: 'closed' as const }])(
    'rejects manual space accounting updates %p even from a trusted caller',
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
        spaceId: spaceId,
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
      spaceId: spaceId,
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
