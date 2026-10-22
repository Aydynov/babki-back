import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ExpenseCategory } from '../expense-categories/schemas/expense-category.schema';
import { ExpensesService } from '../transactions/expenses/expenses.service';
import { ClosePlanDto } from './dto/close-plan.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { Plan } from './schemas/plan.schema';
import { PlansService } from './plans.service';
describe('PlansService', () => {
  const budget = { spaceId: new Types.ObjectId('507f1f77bcf86cd799439099') };
  const userId = '507f1f77bcf86cd799439011';
  const planId = '507f1f77bcf86cd799439012';
  const categoryId = '507f1f77bcf86cd799439013';
  const expenseId = '507f1f77bcf86cd799439014';
  const accountId = '507f1f77bcf86cd799439015';
  const mockSession = {
    withTransaction: jest.fn().mockImplementation(async (fn) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const planModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    countDocuments: jest.fn(),
  };
  const expenseCategoryModel = { findOneAndUpdate: jest.fn() };
  const expensesService = { createForBudget: jest.fn() };
  let service: PlansService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getModelToken(Plan.name), useValue: planModel },
        {
          provide: getModelToken(ExpenseCategory.name),
          useValue: expenseCategoryModel,
        },
        { provide: ExpensesService, useValue: expensesService },
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
    it('creates a space plan after locking its category', async () => {
      const mockPlan = {
        _id: new Types.ObjectId(planId),
        ...dto,
        status: 'active',
      };
      planModel.create.mockResolvedValue([{ toObject: () => mockPlan }]);
      const result = await service.createForBudget(
        budget,
        userId,
        dto,
        mockSession as never,
      );
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

    it('throws NotFoundException when category does not exist', async () => {
      expenseCategoryModel.findOneAndUpdate.mockReturnValue({
        session: jest.fn(),
        lean: () => ({ exec: async () => null }),
      });
      await expect(
        service.createForBudget(budget, userId, dto, mockSession as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(planModel.create).not.toHaveBeenCalled();
    });
  });
  // ─── findAll ──────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns paginated plans filtered by status', async () => {
      const mockPlan = { _id: new Types.ObjectId(planId), status: 'active' };
      const exec = jest.fn().mockResolvedValue([mockPlan]);
      const lean = jest.fn().mockReturnValue({ exec });
      const limit = jest.fn().mockReturnValue({ lean });
      const skip = jest.fn().mockReturnValue({ limit });
      const sort = jest.fn().mockReturnValue({ skip });
      planModel.find.mockReturnValue({ sort });
      planModel.countDocuments.mockResolvedValue(1);
      const result = await service.listForBudget(budget, {
        status: 'active',
        page: 1,
        limit: 20,
      });
      expect(planModel.find).toHaveBeenCalledWith({
        ...budget,
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
    it('returns the plan when it belongs to the space', async () => {
      const mockPlan = { _id: new Types.ObjectId(planId) };
      const exec = jest.fn().mockResolvedValue(mockPlan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
      const result = await service.getForBudget(budget, planId);
      expect(planModel.findOne).toHaveBeenCalledWith({
        _id: planId,
        ...budget,
      });
      expect(result).toEqual(mockPlan);
    });
    it('throws NotFoundException when plan does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
      await expect(service.getForBudget(budget, planId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
  // ─── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    const dto: UpdatePlanDto = { amount: 90000 };
    it('updates an active plan', async () => {
      const currentPlan = {
        _id: new Types.ObjectId(planId),
        status: 'active',
        currency: 'RUB',
        amount: 80000,
      };
      const exec = jest.fn().mockResolvedValue(currentPlan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
      const updatedPlan = { ...currentPlan, amount: 90000 };
      const execUpdate = jest.fn().mockResolvedValue(updatedPlan);
      const leanUpdate = jest.fn().mockReturnValue({ exec: execUpdate });
      planModel.findOneAndUpdate.mockReturnValue({ lean: leanUpdate });
      const result = await service.updateForBudget(
        budget,
        planId,
        dto,
        mockSession as never,
      );
      expect(result).toMatchObject({ amount: 90000 });
    });
    it('throws BadRequestException when plan is already closed', async () => {
      const exec = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(planId),
        status: 'closed',
      });
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
      await expect(
        service.updateForBudget(budget, planId, dto, mockSession as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(planModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
    it('throws NotFoundException when plan does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
      await expect(
        service.updateForBudget(budget, planId, dto, mockSession as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
  // ─── remove ───────────────────────────────────────────────────────────────
  describe('remove', () => {
    it('deletes an active plan', async () => {
      planModel.findOne.mockReturnValue({
        session: jest.fn(),
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
      await expect(
        service.removeForBudget(budget, planId, mockSession as never),
      ).resolves.toBeUndefined();
    });
    it('restricts deletion of a closed plan', async () => {
      planModel.findOne.mockReturnValue({
        session: jest.fn(),
        lean: () => ({
          exec: async () => ({
            _id: new Types.ObjectId(planId),
            status: 'closed',
          }),
        }),
      });
      await expect(
        service.removeForBudget(budget, planId, mockSession as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(planModel.findOneAndDelete).not.toHaveBeenCalled();
    });
    it('throws NotFoundException when plan does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
      await expect(
        service.removeForBudget(budget, planId, mockSession as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
  // ─── close ────────────────────────────────────────────────────────────────
  describe('close', () => {
    const activePlan = {
      _id: new Types.ObjectId(planId),
      description: 'Buy a laptop',
      amount: 80000,
      categoryId: new Types.ObjectId(categoryId),
      status: 'active' as const,
      currency: 'RUB',
    };
    function mockFindOne(plan: typeof activePlan | null) {
      const exec = jest.fn().mockResolvedValue(plan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOne.mockReturnValue({ lean, session: jest.fn() });
    }
    function mockFindOneAndUpdate(plan: object | null) {
      const exec = jest.fn().mockResolvedValue(plan);
      const lean = jest.fn().mockReturnValue({ exec });
      planModel.findOneAndUpdate.mockReturnValue({ lean });
    }
    it('closes an active plan and creates an expense with plan values when dto is empty', async () => {
      mockFindOne(activePlan);
      const createdExpense = {
        _id: new Types.ObjectId(expenseId),
        currency: 'RUB',
      };
      expensesService.createForBudget.mockResolvedValue(createdExpense);
      const closedPlan = {
        ...activePlan,
        status: 'closed',
        closedAt: new Date(),
        expenseId: createdExpense._id,
      };
      mockFindOneAndUpdate(closedPlan);
      const result = await service.closeForBudget(
        budget,
        userId,
        planId,
        { accountId },
        mockSession as never,
      );
      expect(expensesService.createForBudget).toHaveBeenCalledWith(
        {
          ...budget,
        },
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
          ...budget,
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
      mockFindOne(activePlan);
      const createdExpense = {
        _id: new Types.ObjectId(expenseId),
        currency: 'RUB',
      };
      expensesService.createForBudget.mockResolvedValue(createdExpense);
      const closedPlan = { ...activePlan, status: 'closed' };
      mockFindOneAndUpdate(closedPlan);
      const dto: ClosePlanDto = {
        accountId,
        amount: 75000,
        description: 'Refurbished laptop',
        closingDate: '2026-07-15',
      };
      await service.closeForBudget(
        budget,
        userId,
        planId,
        dto,
        mockSession as never,
      );
      expect(expensesService.createForBudget).toHaveBeenCalledWith(
        {
          ...budget,
        },
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
      mockFindOne({
        ...activePlan,
        status: 'closed',
      } as unknown as typeof activePlan);
      await expect(
        service.closeForBudget(
          budget,
          userId,
          planId,
          { accountId },
          mockSession as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(expensesService.createForBudget).not.toHaveBeenCalled();
    });
    it('throws NotFoundException when plan does not exist', async () => {
      mockFindOne(null);
      await expect(
        service.closeForBudget(
          budget,
          userId,
          planId,
          { accountId },
          mockSession as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(expensesService.createForBudget).not.toHaveBeenCalled();
    });
    it('throws BadRequestException when plan is closed concurrently during transaction', async () => {
      mockFindOne(activePlan);
      const createdExpense = {
        _id: new Types.ObjectId(expenseId),
        currency: 'RUB',
      };
      expensesService.createForBudget.mockResolvedValue(createdExpense);
      // Simulate concurrent close: findOneAndUpdate returns null because status no longer 'active'
      mockFindOneAndUpdate(null);
      await expect(
        service.closeForBudget(
          budget,
          userId,
          planId,
          { accountId },
          mockSession as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
  describe('shared budget core', () => {
    const budget = {
      spaceId: new Types.ObjectId('507f1f77bcf86cd799439099'),
    };
    const dto: CreatePlanDto = {
      currency: 'KWD',
      description: 'Small unit',
      targetDate: '2026-12-01',
      amount: 0.001,
      categoryId,
    };
    it('creates the minimum KWD space unit without personal ownership or starting a nested session', async () => {
      planModel.create.mockImplementation(async (rows: object[]) => [
        { toObject: () => rows[0] },
      ]);
      const result = await service.createForBudget(
        budget,
        userId,
        dto,
        mockSession as never,
      );
      expect(result).toMatchObject({
        ...budget,
        createdBy: new Types.ObjectId(userId),
        amount: 0.001,
      });
      expect(result).not.toHaveProperty('userId');
    });
    it.each([0, -1, 0.0001, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects nonpositive or invalid precision amount %s',
      async (amount) => {
        await expect(
          service.createForBudget(
            budget,
            userId,
            { ...dto, amount },
            mockSession as never,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(planModel.create).not.toHaveBeenCalled();
      },
    );
    it('scopes archived detail to the space and supplied session', async () => {
      const archived = {
        _id: new Types.ObjectId(planId),
        ...budget,
        archivedAt: new Date(),
      };
      const query = {
        session: jest.fn(),
        session: jest.fn(),
        lean: () => ({ exec: async () => archived }),
      };
      planModel.findOne.mockReturnValue(query);
      await expect(
        service.getForBudget(budget, planId, mockSession as never),
      ).resolves.toEqual(archived);
      expect(planModel.findOne).toHaveBeenCalledWith({
        _id: planId,
        ...budget,
      });
      expect(query.session).toHaveBeenCalledWith(mockSession);
    });
    it('forwards executor, participant and origin to exactly one expense in the supplied session', async () => {
      const plan = {
        _id: new Types.ObjectId(planId),
        ...budget,
        createdBy: new Types.ObjectId(categoryId),
        categoryId: new Types.ObjectId(categoryId),
        currency: 'KWD',
        amount: 0.001,
        description: 'Small unit',
        status: 'active',
      };
      planModel.findOne.mockReturnValue({
        session: jest.fn(),
        lean: () => ({ exec: async () => plan }),
      });
      expensesService.createForBudget.mockResolvedValue({
        _id: new Types.ObjectId(expenseId),
        currency: 'KWD',
      });
      planModel.findOneAndUpdate.mockReturnValue({
        session: jest.fn(),
        lean: () => ({
          exec: async () => ({
            ...plan,
            status: 'closed',
            expenseId: new Types.ObjectId(expenseId),
          }),
        }),
      });
      const closed = await service.closeForBudget(
        budget,
        userId,
        planId,
        { accountId, amount: 0.002, participantId: categoryId },
        mockSession as never,
      );
      expect(closed).toMatchObject({
        amount: 0.001,
        createdBy: plan.createdBy,
        status: 'closed',
      });
      expect(expensesService.createForBudget).toHaveBeenCalledTimes(1);
      expect(expensesService.createForBudget).toHaveBeenCalledWith(
        budget,
        userId,
        expect.objectContaining({ amount: 0.002, participantId: categoryId }),
        mockSession,
        { type: 'plan', id: new Types.ObjectId(planId) },
      );
    });
  });
});
