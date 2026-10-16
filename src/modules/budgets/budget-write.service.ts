import {
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { BudgetContext } from 'src/common/budget/budget-context';
import {
  GroupsAccessService,
  GroupPermission,
} from '../groups/groups-access.service';

@Injectable()
export class BudgetWriteService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsAccessService,
  ) {}
  async run<T>(
    budget: BudgetContext,
    actorId: string,
    work: (session: ClientSession) => Promise<T>,
    permission?: GroupPermission,
    suppliedSession?: ClientSession,
  ): Promise<T> {
    const execute = async (session: ClientSession) => {
      if (budget.ownerType === 'group') {
        const id = String(budget.ownerId);
        await this.groups.serializeMutation(id, session);
        if (permission)
          await this.groups.requirePermission(id, actorId, permission, session);
        else await this.groups.requireMember(id, actorId, session);
      } else if (!budget.ownerId.equals(actorId))
        throw new NotFoundException('Budget not found');
      return work(session);
    };
    let ownedSession: ClientSession | undefined;
    try {
      if (suppliedSession) return await execute(suppliedSession);
      ownedSession = await this.connection.startSession();
      const session = ownedSession;
      return await session.withTransaction(
        () => execute(session),
        budget.ownerType === 'group'
          ? { timeoutMS: 15000, maxCommitTimeMS: 10000 }
          : undefined,
      );
    } catch (error) {
      if (budget.ownerType === 'user' || error instanceof HttpException)
        throw error;
      throw new ServiceUnavailableException(
        'Financial operation could not be completed',
      );
    } finally {
      await ownedSession?.endSession();
    }
  }
}
