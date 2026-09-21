import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import {
  GroupsAccessService,
  GroupPermission,
} from '../groups/groups-access.service';
@Injectable()
export class GroupFinanceWriteService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsAccessService,
  ) {}
  async run<T>(
    groupId: string,
    actorId: string,
    work: (session: ClientSession) => Promise<T>,
    permission?: GroupPermission,
  ): Promise<T> {
    let session: ClientSession | undefined;
    try {
      session = await this.connection.startSession();
      const activeSession = session;
      return await session.withTransaction(
        async () => {
          await this.groups.serializeMutation(groupId, activeSession);
          if (permission)
            await this.groups.requirePermission(
              groupId,
              actorId,
              permission,
              activeSession,
            );
          else await this.groups.requireMember(groupId, actorId, activeSession);
          return work(activeSession);
        },
        { timeoutMS: 15000, maxCommitTimeMS: 10000 },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Financial operation could not be completed',
      );
    } finally {
      await session?.endSession();
    }
  }
}
