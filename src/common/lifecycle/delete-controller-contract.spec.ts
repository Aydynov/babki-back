import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AccountsController } from 'src/modules/accounts/accounts/accounts.controller';
import { DebtsController } from 'src/modules/debts/debts.controller';
import { ExpenseCategoriesController } from 'src/modules/expense-categories/expense-categories.controller';
import { ExpenseLimitsController } from 'src/modules/expense-limits/expense-limits.controller';
import { PlansController } from 'src/modules/plans/plans.controller';
import { TransactionsController } from 'src/modules/transactions/transactions/transactions.controller';
import {
  DeletionRestrictedException,
  DeletionTargetNotFoundException,
} from './deletion-policy';

describe('personal DELETE controller contract', () => {
  const handlers: Array<[string, (...args: never[]) => unknown]> = [
    ['accounts', AccountsController.prototype.delete],
    ['transactions', TransactionsController.prototype.delete],
    ['expense categories', ExpenseCategoriesController.prototype.remove],
    ['expense limits', ExpenseLimitsController.prototype.delete],
    ['plans', PlansController.prototype.remove],
    ['debts', DebtsController.prototype.remove],
  ];

  it.each(handlers)('%s returns 204 without a response body', (_name, handler) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(
      HttpStatus.NO_CONTENT,
    );
  });

  it.each([
    [new DeletionTargetNotFoundException('Account'), HttpStatus.NOT_FOUND],
    [
      new DeletionRestrictedException('Account has financial history'),
      HttpStatus.CONFLICT,
    ],
  ])('preserves lifecycle error status %#', async (exception, status) => {
    const accountsService = {
      deleteEntity: jest.fn().mockRejectedValue(exception),
    };
    const controller = new AccountsController(accountsService as never);

    await expect(
      controller.delete(
        { userId: '507f1f77bcf86cd799439011' } as never,
        '507f191e810c19729de860ea',
      ),
    ).rejects.toMatchObject({ status });
  });
});
