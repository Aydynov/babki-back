import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { User } from '../users/schemas/user.schema';
import { ClosePlanDto } from './dto/close-plan.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { Plan } from './schemas/plan.schema';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const planId = '507f1f77bcf86cd799439012';
  const categoryId = '507f1f77bcf86cd799439013';
  const expenseId = '507f1f77bcf86cd799439014';
  const accountId = '507f1f77bcf86cd799439015';

  const mockSession = {
    withTransaction: jest.fn().mockImplementation(async (fn) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };
  const planModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    countDocuments: jest.fn(),
  };
  const userModel = { exists: jest.fn() };
  const expenseCategoryModel = { findOneAndUpdate: jest.fn() };
  const expensesService = { create: jest.fn() };

  let service: PlansService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getModelToken(Plan.name), useValue: planModel },
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: getModelToken(ExpenseCategory.name),
          useValue: expenseCategoryModel,
        },
        { provide: ExpensesService, useValue: expensesService },
        { provide: getConnectionToken(), useValue: mockConnection },
      ],
    }).compile();

    service = moduleRef.get(PlansService);
    expenseCategoryModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          _id: new Types.ObjectId(categoryId),
          isArchived: false,
        }),
      }),
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreatePlanDto = {
      currency: 'RUB',
      description: 'Buy a laptop',
      targetDate: '2026-08-01',
      amount: 80000,
      categoryId,
    };

    it('creates a plan after validating user and category', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const mockPlan = {
        _id: new Types.ObjectId(planId),
        ...dto,
        status: 'active',
      };
      planModel.create.mockResolvedValue([{ toObject: () => mockPlan }]);

      const result = await service.create(userId, dto);

      expect(userModel.exists).toHaveBeenCalledWith({ _id: userId });
      expect(expenseCategoryModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: new Types.ObjectId(categoryId) }),
        { $inc: { mutationVersion: 1 } },
        expect.objectContaining({ session: mockSession }),
      );
      expect(result).toMatchObject({
        description: 'Buy a laptop',
        status: 'active',
      });
    });

    it('throws NotFoundException when user does not exist', async () => {
      userModel.exists.mockResolvedValue(null);

      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(planModel.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when category does not exist', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      expenseCategoryModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: async () => null }),
      });

      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(planModel.create).not.toHaveBeenCalled();
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated plans filtered by status', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });

      const mockPlan = { _id: new Types.ObjectId(planId), status: 'active' };
      const exec = jest.fn().mockResolvedValue([mockPlan]);
      const lean = jest.fn().mockReturnValue({ exec });
      const limit = jest.fn().mockReturnValue({ lean });
      const skip = jest.fn().mockReturnValue({ limit });
      const sort = jest.fn().mockReturnValue({ skip });
      planModel.find.mockReturnValue({ sort });
      planModel.countDocuments.mockResolvedValue(1);

      const result = await service.findAll(userId, {
        status: 'active',
        page: 1,
        limit: 20,
      });

      expect(planModel.find).toHaveBeenCalledWith({
        userId: new Types.ObjectId(userId),
        status: 'active',
        archivedAt: null,
      });
      expect(result).toEqual({
        items: [mockPlan],
        total: 1,
        page: 1,
        limit: 20,
      });
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the plan when it belongs to the user', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const mockPlan = { _id: new Types.ObjectId(planId) };
      const exec = jest.fn().mockResolvedValue(mockPlan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });

      const result = await service.findOne(userId, planId);

      expect(planModel.findOne).toHaveBeenCalledWith({
        _id: planId,
        userId: new Types.ObjectId(userId),
        archivedAt: null,
      });
      expect(result).toEqual(mockPlan);
    });

    it('throws NotFoundException when plan does not exist', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const exec = jest.fn().mockResolvedValue(null);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });

      await expect(service.findOne(userId, planId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    const dto: UpdatePlanDto = { amount: 90000 };

    it('updates an active plan', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const currentPlan = {
        _id: new Types.ObjectId(planId),
        status: 'active',
        currency: 'RUB',
        amount: 80000,
      };
      const exec = jest.fn().mockResolvedValue(currentPlan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });

      const updatedPlan = { ...currentPlan, amount: 90000 };
      const execUpdate = jest.fn().mockResolvedValue(updatedPlan);
      const leanUpdate = jest.fn().mockReturnValue({ exec: execUpdate });
      planModel.findOneAndUpdate.mockReturnValue({ lean: leanUpdate });

      const result = await service.update(userId, planId, dto);

      expect(result).toMatchObject({ amount: 90000 });
    });

    it('throws BadRequestException when plan is already closed', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const exec = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(planId),
        status: 'closed',
      });
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });

      await expect(service.update(userId, planId, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(planModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when plan does not exist', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const exec = jest.fn().mockResolvedValue(null);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });

      await expect(service.update(userId, planId, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes an active plan', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      planModel.findOne.mockReturnValue({
        lean: () => ({
          exec: async () => ({
            _id: new Types.ObjectId(planId),
            status: 'active',
          }),
        }),
      });
      const exec = jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(planId) });
      planModel.findOneAndDelete.mockReturnValue({ exec });

      await expect(service.remove(userId, planId)).resolves.toBeUndefined();
    });

    it('restricts deletion of a closed plan', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      planModel.findOne.mockReturnValue({
        lean: () => ({
          exec: async () => ({
            _id: new Types.ObjectId(planId),
            status: 'closed',
          }),
        }),
      });

      await expect(service.remove(userId, planId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(planModel.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when plan does not exist', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      const exec = jest.fn().mockResolvedValue(null);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });

      await expect(service.remove(userId, planId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── close ────────────────────────────────────────────────────────────────

  describe('close', () => {
    const activePlan = {
      _id: new Types.ObjectId(planId),
      userId: new Types.ObjectId(userId),
      description: 'Buy a laptop',
      amount: 80000,
      categoryId: new Types.ObjectId(categoryId),
      status: 'active' as const,
      currency: 'RUB',
    };

    function mockFindOne(plan: typeof activePlan | null) {
      const exec = jest.fn().mockResolvedValue(plan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean });
    }

    function mockFindOneAndUpdate(plan: object | null) {
      const exec = jest.fn().mockResolvedValue(plan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOneAndUpdate.mockReturnValue({ lean });
    }

    it('closes an active plan and creates an expense with plan values when dto is empty', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      mockFindOne(activePlan);

      const createdExpense = {
        _id: new Types.ObjectId(expenseId),
        currency: 'RUB',
      };
      expensesService.create.mockResolvedValue(createdExpense);

      const closedPlan = {
        ...activePlan,
        status: 'closed',
        closedAt: new Date(),
        expenseId: createdExpense._id,
      };
      mockFindOneAndUpdate(closedPlan);

      const result = await service.close(userId, planId, { accountId });

      expect(expensesService.create).toHaveBeenCalledWith(
        userId,
        {
          accountId,
          categoryId: categoryId,
          amount: activePlan.amount,
          transactionDate: expect.any(String),
          description: activePlan.description,
        },
        expect.anything(),
        { type: 'plan', id: new Types.ObjectId(planId) },
      );
      expect(planModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: planId,
          userId: new Types.ObjectId(userId),
          status: 'active',
          archivedAt: null,
        },
        expect.objectContaining({
          status: 'closed',
          expenseId: createdExpense._id,
        }),
        expect.objectContaining({ returnDocument: 'after' }),
      );
      expect(result).toMatchObject({ status: 'closed' });
    });

    it('uses dto overrides (amount, description, closingDate) when provided', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      mockFindOne(activePlan);

      const createdExpense = {
        _id: new Types.ObjectId(expenseId),
        currency: 'RUB',
      };
      expensesService.create.mockResolvedValue(createdExpense);

      const closedPlan = { ...activePlan, status: 'closed' };
      mockFindOneAndUpdate(closedPlan);

      const dto: ClosePlanDto = {
        accountId,
        amount: 75000,
        description: 'Refurbished laptop',
        closingDate: '2026-07-15',
      };
      await service.close(userId, planId, dto);

      expect(expensesService.create).toHaveBeenCalledWith(
        userId,
        {
          accountId,
          categoryId: categoryId,
          amount: 75000,
          transactionDate: '2026-07-15',
          description: 'Refurbished laptop',
        },
        expect.anything(),
        { type: 'plan', id: new Types.ObjectId(planId) },
      );
    });

    it('throws BadRequestException when plan is already closed', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      mockFindOne({
        ...activePlan,
        status: 'closed',
      } as unknown as typeof activePlan);

      await expect(
        service.close(userId, planId, { accountId }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(expensesService.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when plan does not exist', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      mockFindOne(null);

      await expect(
        service.close(userId, planId, { accountId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(expensesService.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when plan is closed concurrently during transaction', async () => {
      userModel.exists.mockResolvedValue({ _id: new Types.ObjectId(userId) });
      mockFindOne(activePlan);

      const createdExpense = {
        _id: new Types.ObjectId(expenseId),
        currency: 'RUB',
      };
      expensesService.create.mockResolvedValue(createdExpense);

      // Simulate concurrent close: findOneAndUpdate returns null because status no longer 'active'
      mockFindOneAndUpdate(null);

      await expect(
        service.close(userId, planId, { accountId }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
