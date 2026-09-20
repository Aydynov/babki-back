import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GroupsTransactionService } from './groups-transaction.service';

describe('GroupsTransactionService', () => {
  const endSession = jest.fn();
  const withTransaction = jest.fn();
  const connection = {
    startSession: jest.fn().mockResolvedValue({ withTransaction, endSession }),
  };
  const service = new GroupsTransactionService(connection as never);
  beforeEach(() => jest.clearAllMocks());
  it('allows the driver to invoke a fresh authorization callback on retry', async () => {
    const callback = jest
      .fn()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new ForbiddenException());
    withTransaction.mockImplementation(async (work: () => Promise<unknown>) => {
      await work();
      return work();
    });
    await expect(service.run(callback)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(callback).toHaveBeenCalledTimes(2);
    expect(endSession).toHaveBeenCalledTimes(1);
  });
  it('normalizes exhausted transaction retries without exposing driver details', async () => {
    withTransaction.mockRejectedValue(new Error('secret database details'));
    await expect(service.run(jest.fn())).rejects.toEqual(
      new ServiceUnavailableException(
        'Group operation temporarily unavailable',
      ),
    );
    expect(endSession).toHaveBeenCalledTimes(1);
  });
});
