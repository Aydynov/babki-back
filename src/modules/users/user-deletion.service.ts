import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Group } from '../groups/schemas/group.schema';
import {
  UserDeletionJob,
  UserDeletionJobDocument,
  UserDeletionStage,
} from './schemas/user-deletion-job.schema';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UserDeletionService {
  private readonly enabled: boolean;

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(UserDeletionJob.name)
    private readonly jobs: Model<UserDeletionJobDocument>,
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('userDeletion.enabled', false);
  }

  async request(userId: string) {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Account deletion is temporarily unavailable.',
      );
    }
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const ownsGroup = await this.groups
          .exists({ ownerId: new Types.ObjectId(userId), deletedAt: null })
          .session(session);
        if (ownsGroup) {
          throw new ConflictException(
            'Transfer ownership or delete owned groups first.',
          );
        }
        const user = await this.users.findOneAndUpdate(
          { _id: userId, status: 'active' },
          {
            $set: { status: 'deletion_pending' },
            $inc: { authVersion: 1 },
          },
          { returnDocument: 'after', session },
        );
        if (!user) {
          throw new NotFoundException('Active user not found.');
        }
        await this.jobs.updateOne(
          { userId: new Types.ObjectId(userId) },
          {
            $setOnInsert: {
              userId: new Types.ObjectId(userId),
              stage: 'memberships',
              requestedAt: new Date(),
            },
          },
          { upsert: true, session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
}

@Injectable()
export class UserDeletionWorker {
  private readonly leaseMs: number;

  constructor(
    @InjectModel(UserDeletionJob.name)
    private readonly jobs: Model<UserDeletionJobDocument>,
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService,
  ) {
    this.leaseMs = config.get<number>('userDeletion.leaseSeconds', 300) * 1000;
  }

  async runOnce(workerId: string, now = new Date()) {
    const job = await this.jobs
      .findOneAndUpdate(
        {
          completedAt: null,
          $or: [
            { leaseOwner: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            leaseOwner: workerId,
            leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after', sort: { requestedAt: 1 } },
      )
      .select('+lastError')
      .lean()
      .exec();
    if (!job) return false;

    try {
      await this.processStage(job.userId, job.stage, now);
      await this.advance(job._id, workerId, job.stage, now);
    } catch {
      await this.jobs.updateOne(
        { _id: job._id, leaseOwner: workerId },
        {
          $set: {
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: `Stage ${job.stage} failed.`,
          },
        },
      );
      throw new Error(`User deletion stage ${job.stage} failed.`);
    }
    return true;
  }

  async diagnose(userId: string) {
    const user = new Types.ObjectId(userId);
    const personal = { ownerType: 'user', ownerId: user };
    const accounts = await this.connection
      .collection('accounts')
      .find(personal, { projection: { _id: 1 } })
      .toArray();
    const accountIds = accounts.map(({ _id }) => _id);
    const count = (name: string, filter: object) =>
      this.connection.collection(name).countDocuments(filter);
    return {
      userId,
      memberships: await count('groupmemberships', {
        userId: user,
        status: 'active',
      }),
      personalFinance: {
        transactions: await count('transactions', personal),
        snapshots: await count('accountsnapshots', {
          accountId: { $in: accountIds },
        }),
        accounts: accounts.length,
        limits: await count('expenselimits', personal),
        plans: await count('plans', { userId: user }),
        debtTransactions: await count('debttransactions', { userId: user }),
        debts: await count('debts', { userId: user }),
        categories: await count('expensecategories', personal),
      },
      authData: {
        challenges: await count('authchallenges', { userId: user }),
        twoFactor: await count('usertwofactors', { userId: user }),
        auditEvents: await count('securityauditevents', { userId: user }),
      },
    };
  }

  private async processStage(
    userId: Types.ObjectId,
    stage: UserDeletionStage,
    now: Date,
  ) {
    if (stage === 'memberships') {
      await this.connection.collection('groupmemberships').updateMany(
        { userId, status: 'active' },
        {
          $set: {
            status: 'removed',
            endedAt: now,
            endReason: 'user_deleted',
          },
        },
      );
      return;
    }
    if (stage === 'personal_finance') {
      const personal = { ownerType: 'user', ownerId: userId };
      const accounts = await this.connection
        .collection('accounts')
        .find(personal, { projection: { _id: 1 } })
        .toArray();
      const accountIds = accounts.map(({ _id }) => _id);
      await this.connection.collection('transactions').deleteMany(personal);
      await this.connection.collection('accountsnapshots').deleteMany({
        accountId: { $in: accountIds },
      });
      await this.connection.collection('accounts').deleteMany(personal);
      await this.connection.collection('expenselimits').deleteMany(personal);
      await this.connection.collection('plans').deleteMany({ userId });
      await this.connection
        .collection('debttransactions')
        .deleteMany({ userId });
      await this.connection.collection('debts').deleteMany({ userId });
      await this.connection
        .collection('expensecategories')
        .deleteMany(personal);
      return;
    }
    if (stage === 'auth_data') {
      await this.connection.collection('authchallenges').deleteMany({ userId });
      await this.connection.collection('usertwofactors').deleteMany({ userId });
      await this.connection
        .collection('securityauditevents')
        .updateMany(
          { userId },
          { $unset: { 'context.ip': '', 'context.userAgent': '' } },
        );
      return;
    }
    if (stage === 'tombstone') {
      await this.connection.collection('users').updateOne(
        { _id: userId, status: { $ne: 'deleted' } },
        {
          $set: { status: 'deleted', deletedAt: now },
          $unset: {
            firstName: '',
            lastName: '',
            email: '',
            passwordHash: '',
            description: '',
          },
        },
      );
    }
  }

  private async advance(
    jobId: Types.ObjectId,
    workerId: string,
    stage: UserDeletionStage,
    now: Date,
  ) {
    const next: Record<UserDeletionStage, UserDeletionStage> = {
      memberships: 'personal_finance',
      personal_finance: 'auth_data',
      auth_data: 'tombstone',
      tombstone: 'completed',
      completed: 'completed',
    };
    await this.jobs.updateOne(
      { _id: jobId, leaseOwner: workerId, stage },
      {
        $set: {
          stage: next[stage],
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          ...(next[stage] === 'completed' ? { completedAt: now } : {}),
        },
      },
    );
  }
}
