import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Debt } from '../debts/schemas/debt.schema';
import { DebtTransactionsService } from './debt-transactions.service';
import { DebtTransaction } from './schemas/debt-transaction.schema';

describe('DebtTransactionsService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const debtId = '507f1f77bcf86cd799439012';
  const debtTransactionId = '507f1f77bcf86cd799439013';
  const debtModel = {
    exists: jest.fn(),
  };
  const debtTransactionModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
  };

  let service: DebtTransactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DebtTransactionsService,
        {
          provide: getModelToken(DebtTransaction.name),
          useValue: debtTransactionModel,
        },
        { provide: getModelToken(Debt.name), useValue: debtModel },
      ],
    }).compile();

    service = moduleRef.get(DebtTransactionsService);
  });

  it('lists transactions only after verifying the debt belongs to the user', async () => {
    debtModel.exists.mockResolvedValue({ _id: new Types.ObjectId(debtId) });
    const exec = jest.fn().mockResolvedValue([{ _id: debtTransactionId }]);
    const lean = jest.fn().mockReturnValue({ exec });
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    debtTransactionModel.find.mockReturnValue({ sort });
    debtTransactionModel.countDocuments.mockResolvedValue(1);

    const result = await service.findAll(userId, debtId, {
      page: 1,
      limit: 20,
    });

    expect(debtModel.exists).toHaveBeenCalledWith({
      _id: debtId,
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
      userId: new Types.ObjectId(userId),
    });
    expect(debtTransactionModel.find).toHaveBeenCalledWith({
      debtId: new Types.ObjectId(debtId),
      ownerType: 'user',
      ownerId: new Types.ObjectId(userId),
      userId: new Types.ObjectId(userId),
    });
    expect(result.total).toBe(1);
  });

  it('blocks access to another user debt transactions', async () => {
    debtModel.exists.mockResolvedValue(null);

    await expect(
      service.findOne(userId, debtId, debtTransactionId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(debtTransactionModel.findOne).not.toHaveBeenCalled();
  });
});
