import { ConfigService } from '@nestjs/config';
import { Connection, Model, Types } from 'mongoose';
import { UserDeletionWorker } from './user-deletion.service';
import { UserDeletionJobDocument } from './schemas/user-deletion-job.schema';

describe('UserDeletionWorker', () => {
  it('queries the same unfinished-job predicate used by the partial index', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const jobs = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec }),
        }),
      }),
    };
    const config = {
      get: jest.fn().mockReturnValue(300),
    };
    const worker = new UserDeletionWorker(
      jobs as unknown as Model<UserDeletionJobDocument>,
      {} as Connection,
      config as unknown as ConfigService,
    );

    await expect(worker.runOnce('worker')).resolves.toBe(false);

    expect(jobs.findOneAndUpdate).toHaveBeenCalledWith(
      {
        completedAt: null,
        $or: [
          { leaseOwner: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $lte: expect.any(Date) } },
        ],
      },
      expect.any(Object),
      { returnDocument: 'after', sort: { requestedAt: 1 } },
    );
  });
  it('finishes identity cleanup without accessing any financial collection', async () => {
    const userId = new Types.ObjectId();
    const jobId = new Types.ObjectId();
    const now = new Date('2026-10-21T00:00:00Z');
    const updateMany = jest.fn().mockResolvedValue({});
    const deleteMany = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn().mockImplementation((name: string) => {
      if (
        ![
          'spacememberships',
          'authchallenges',
          'usertwofactors',
          'securityauditevents',
          'users',
        ].includes(name)
      ) {
        throw new Error(`Financial collection accessed: ${name}`);
      }
      return { updateMany, deleteMany, updateOne };
    });
    const exec = jest.fn();
    const jobs = {
      findOneAndUpdate: jest.fn(() => ({
        select: () => ({ lean: () => ({ exec }) }),
      })),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const worker = new UserDeletionWorker(
      jobs as unknown as Model<UserDeletionJobDocument>,
      { collection } as unknown as Connection,
      { get: () => 300 } as unknown as ConfigService,
    );
    for (const [stage, next] of [
      ['memberships', 'auth_data'],
      ['auth_data', 'tombstone'],
      ['tombstone', 'completed'],
    ]) {
      exec.mockResolvedValue({ _id: jobId, userId, stage });
      await expect(worker.runOnce('worker', now)).resolves.toBe(true);
      expect(jobs.updateOne).toHaveBeenLastCalledWith(
        { _id: jobId, leaseOwner: 'worker', stage },
        { $set: expect.objectContaining({ stage: next }) },
      );
    }
    expect(updateMany).toHaveBeenCalledWith(
      { userId, status: 'active' },
      { $set: { status: 'removed', endedAt: now, endReason: 'user_deleted' } },
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: userId, status: { $ne: 'deleted' } },
      expect.objectContaining({ $set: { status: 'deleted', deletedAt: now } }),
    );
  });
});
