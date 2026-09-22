import { ConfigService } from '@nestjs/config';
import { Connection, Model } from 'mongoose';
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
});
