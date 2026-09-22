import { HttpStatus } from '@nestjs/common';
import {
  DeletionRestrictedException,
  DeletionStrategy,
  DeletionTargetNotFoundException,
} from './deletion-policy';

describe('deletion lifecycle contract', () => {
  it('exposes every supported aggregate deletion strategy', () => {
    expect(Object.values(DeletionStrategy)).toEqual([
      'RESTRICT',
      'ARCHIVE',
      'CASCADE',
      'ERASE/ANONYMIZE',
    ]);
  });

  it('maps a missing deletion target to a safe 404 response', () => {
    const exception = new DeletionTargetNotFoundException('Account');

    expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(exception.getResponse()).toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
      message: 'Account not found',
      error: 'Not Found',
    });
  });

  it('maps a restricted deletion to a safe 409 response', () => {
    const exception = new DeletionRestrictedException(
      'Account has financial history',
    );

    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.getResponse()).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      message: 'Account has financial history',
      error: 'Conflict',
    });
  });
});
