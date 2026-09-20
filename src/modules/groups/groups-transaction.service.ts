import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';

@Injectable()
export class GroupsTransactionService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  async run<T>(callback: (session: ClientSession) => Promise<T>): Promise<T> {
    let session: ClientSession | undefined;
    try {
      session = await this.connection.startSession();
      return await session.withTransaction(() => callback(session!), {
        maxCommitTimeMS: 10000,
        timeoutMS: 15000,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Group operation temporarily unavailable',
      );
    } finally {
      await session?.endSession();
    }
  }
}
