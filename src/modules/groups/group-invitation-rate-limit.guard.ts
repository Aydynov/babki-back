import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request, Response } from 'express';
import { Model } from 'mongoose';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { GroupInvitationRateLimit } from './schemas/group-invitation-rate-limit.schema';

@Injectable()
export class GroupInvitationRateLimitGuard implements CanActivate {
  constructor(
    @InjectModel(GroupInvitationRateLimit.name)
    private readonly limits: Model<GroupInvitationRateLimit>,
  ) {}
  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const user = http.getRequest<Request>().user as
      AuthenticatedUser | undefined;
    if (!user) throw new UnauthorizedException();
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / 60000) * 60000);
    const expiresAt = new Date(windowStart.getTime() + 60000);
    const filter = { userId: user.userId, windowStart };
    let record: GroupInvitationRateLimit | null;
    try {
      try {
        record = await this.limits.findOneAndUpdate(
          filter,
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, returnDocument: 'after' },
        );
      } catch (error: unknown) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 11000
        ))
          throw error;
        record = await this.limits.findOneAndUpdate(
          filter,
          { $inc: { count: 1 } },
          { returnDocument: 'after' },
        );
      }
      if (!record) throw new Error('Missing counter');
    } catch {
      throw new ServiceUnavailableException(
        'Invitation acceptance temporarily unavailable',
      );
    }
    if (record.count > 10) {
      http
        .getResponse<Response>()
        .setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
        );
      throw new HttpException(
        'Too many invitation attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
