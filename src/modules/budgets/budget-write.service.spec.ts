import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientSession, Connection, Types } from 'mongoose';
import { GroupsAccessService } from '../groups/groups-access.service';
import { BudgetWriteService } from './budget-write.service';

describe('budget transaction boundary', () => {
  const ownerId = new Types.ObjectId();
  const group = {
    serializeMutation: jest.fn(),
    requireMember: jest.fn(),
    requirePermission: jest.fn(),
  };
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn(async () => session) };
  const service = new BudgetWriteService(
    connection as unknown as Connection,
    group as unknown as GroupsAccessService,
  );
  beforeEach(() => jest.clearAllMocks());

  it('adopts the caller session without starting or ending another transaction', async () => {
    const supplied = {} as ClientSession;
    const result = await service.run(
      { ownerType: 'user', ownerId },
      String(ownerId),
      async (active) => {
        expect(active).toBe(supplied);
        return 42;
      },
      undefined,
      supplied,
    );
    expect(result).toBe(42);
    expect(connection.startSession).not.toHaveBeenCalled();
    expect(session.endSession).not.toHaveBeenCalled();
  });

  it('keeps personal failures and group HTTP failures while mapping group storage errors', async () => {
    const storageError = new Error('Storage unavailable');
    const fail = async () => {
      throw storageError;
    };
    await expect(
      service.run({ ownerType: 'user', ownerId }, String(ownerId), fail),
    ).rejects.toBe(storageError);
    await expect(
      service.run({ ownerType: 'group', ownerId }, String(ownerId), fail),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    const denied = new ForbiddenException();
    group.requireMember.mockRejectedValueOnce(denied);
    await expect(
      service.run(
        { ownerType: 'group', ownerId },
        String(ownerId),
        async () => 1,
      ),
    ).rejects.toBe(denied);
    expect(session.endSession).toHaveBeenCalledTimes(3);
  });
});
