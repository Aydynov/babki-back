import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { BudgetContext } from 'src/common/budget/budget-context';
import {
  SpacePermission,
  SpacesAccessService,
} from '../spaces/spaces-access.service';
@Injectable()
export class BudgetWriteService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    private readonly spaces: SpacesAccessService,
  ) {}
  async run<T>(
    budget: BudgetContext,
    actorId: string,
    work: (session: ClientSession) => Promise<T>,
    permission?: SpacePermission,
    suppliedSession?: ClientSession,
  ): Promise<T> {
    const execute = async (session: ClientSession) => {
      {
        const id = String(budget.spaceId);
        await this.spaces.serializeMutation(id, session);
        if (permission)
          await this.spaces.requirePermission(id, actorId, permission, session);
        else await this.spaces.requireMember(id, actorId, session);
      }
      return work(session);
    };
    let ownedSession: ClientSession | undefined;
    try {
      if (suppliedSession) return await execute(suppliedSession);
      ownedSession = await this.connection.startSession();
      const session = ownedSession;
      return await session.withTransaction(() => execute(session), {
        timeoutMS: 15000,
        maxCommitTimeMS: 10000,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Financial operation could not be completed',
      );
    } finally {
      await ownedSession?.endSession();
    }
  }
}
