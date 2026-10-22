import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { SpaceFinancesController } from 'src/modules/space-finances/space-finances.controller';
import { SpacePlansController } from 'src/modules/space-finances/space-plans.controller';
import { SpaceDebtsController } from 'src/modules/space-finances/space-debts.controller';
import {
  DeletionRestrictedException,
  DeletionTargetNotFoundException,
} from './deletion-policy';

describe('space DELETE controller contract', () => {
  const handlers = [
    ['accounts', SpaceFinancesController.prototype.deleteAccount],
    ['transfers', SpaceFinancesController.prototype.deleteTransfer],
    ['expenses', SpaceFinancesController.prototype.deleteExpense],
    ['incomes', SpaceFinancesController.prototype.deleteIncome],
    ['expense categories', SpaceFinancesController.prototype.deleteCategory],
    ['expense limits', SpaceFinancesController.prototype.deleteLimit],
    ['plans', SpacePlansController.prototype.remove],
    ['debts', SpaceDebtsController.prototype.remove],
  ] as const;
  it.each(handlers)(
    '%s returns 204 without a response body',
    (_name, handler) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(
        HttpStatus.NO_CONTENT,
      );
    },
  );
  it.each([
    [new DeletionTargetNotFoundException('Account'), HttpStatus.NOT_FOUND],
    [
      new DeletionRestrictedException('Account has financial history'),
      HttpStatus.CONFLICT,
    ],
  ])('preserves lifecycle error status %#', async (exception, status) => {
    const wallet = { remove: jest.fn().mockRejectedValue(exception) };
    const controller = new SpaceFinancesController(
      {} as never,
      wallet as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.deleteAccount(
        {},
        '507f1f77bcf86cd799439011',
        { userId: '507f1f77bcf86cd799439012' } as never,
        '507f1f77bcf86cd799439013',
      ),
    ).rejects.toMatchObject({ status });
  });
});
