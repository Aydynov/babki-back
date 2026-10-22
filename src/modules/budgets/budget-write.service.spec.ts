import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientSession, Connection, Types } from 'mongoose';
import { SpacesAccessService } from '../spaces/spaces-access.service';
import { BudgetWriteService } from './budget-write.service';
describe('budget transaction boundary', () => {
  const spaceId = new Types.ObjectId();
  const space = {
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
    space as unknown as SpacesAccessService,
  );
  beforeEach(() => jest.clearAllMocks());
  it('adopts the caller session without starting or ending another transaction', async () => {
    const supplied = {} as ClientSession;
    const result = await service.run(
      { spaceId },
      String(spaceId),
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
  it('preserves space HTTP failures while mapping storage errors', async () => {
    const storageError = new Error('Storage unavailable');
    const fail = async () => {
      throw storageError;
    };
    await expect(
      service.run({ spaceId }, String(spaceId), fail),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    const denied = new ForbiddenException();
    const work = jest.fn(async () => 1);
    space.requireMember.mockRejectedValueOnce(denied);
    await expect(service.run({ spaceId }, String(spaceId), work)).rejects.toBe(
      denied,
    );
    expect(work).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(2);
  });
  it('checks current permission after serializing the space before executing money writes', async () => {
    const order: string[] = [];
    space.serializeMutation.mockImplementationOnce(async () => {
      order.push('serialize');
    });
    space.requirePermission.mockImplementationOnce(async () => {
      order.push('permission');
    });
    await service.run(
      { spaceId },
      String(spaceId),
      async (active) => {
        expect(active).toBe(session);
        order.push('write');
      },
      'manageTransactions',
    );
    expect(order).toEqual(['serialize', 'permission', 'write']);
    expect(space.requirePermission).toHaveBeenCalledWith(
      String(spaceId),
      String(spaceId),
      'manageTransactions',
      session,
    );
    expect(space.requireMember).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
