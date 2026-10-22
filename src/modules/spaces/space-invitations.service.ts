import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { getPagination } from '../../common/utils/pagination.util';
import { SpaceInvitation } from './schemas/space-invitation.schema';
import { SpaceMembershipEvent } from './schemas/space-membership-event.schema';
import { SpaceMembership } from './schemas/space-membership.schema';
import { Space } from './schemas/space.schema';
import { effectivePermissions } from './space-permissions';
import { SpacesAccessService } from './spaces-access.service';
import { SpacesTransactionService } from './spaces-transaction.service';
@Injectable()
export class SpaceInvitationsService {
  constructor(
    @InjectModel(SpaceInvitation.name)
    private readonly invitations: Model<SpaceInvitation>,
    @InjectModel(SpaceMembership.name)
    private readonly memberships: Model<SpaceMembership>,
    @InjectModel(SpaceMembershipEvent.name)
    private readonly events: Model<SpaceMembershipEvent>,
    @InjectModel(Space.name)
    private readonly spaces: Model<Space>,
    private readonly access: SpacesAccessService,
    private readonly transactions: SpacesTransactionService,
  ) {}
  async create(userId: string, spaceId: string) {
    const token = randomBytes(32).toString('base64url');
    return this.transactions.run(async (session) => {
      await this.access.serializeMutation(spaceId, session);
      await this.access.requireOwner(spaceId, userId, session);
      const expiresAt = new Date(Date.now() + 7 * 86400000);
      const [invitation] = await this.invitations.create(
        [
          {
            spaceId,
            createdBy: userId,
            tokenDigest: this.digest(token),
            expiresAt,
            status: 'pending',
          },
        ],
        { session },
      );
      return { id: String(invitation._id), token, expiresAt };
    });
  }
  async findAll(userId: string, spaceId: string, query: PaginationQueryDto) {
    await this.access.requireOwner(spaceId, userId);
    const { page, limit, skip } = getPagination(query);
    const [records, total] = await Promise.all([
      this.invitations
        .find({ spaceId })
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.invitations.countDocuments({ spaceId }),
    ]);
    const now = new Date();
    const items = records.map((record) => ({
      id: String(record._id),
      createdBy: String(record.createdBy),
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status:
        record.status === 'pending' && record.expiresAt <= now
          ? 'expired'
          : record.status,
      ...(record.acceptedBy
        ? {
            acceptedBy: String(record.acceptedBy),
            acceptedAt: record.acceptedAt,
          }
        : {}),
      ...(record.revokedBy
        ? { revokedBy: String(record.revokedBy), revokedAt: record.revokedAt }
        : {}),
    }));
    return { items, total, page, limit };
  }
  async revoke(userId: string, spaceId: string, invitationId: string) {
    await this.transactions.run(async (session) => {
      await this.access.serializeMutation(spaceId, session);
      await this.access.requireOwner(spaceId, userId, session);
      const invitation = await this.invitations
        .findOne({ _id: invitationId, spaceId })
        .session(session);
      if (!invitation) throw new NotFoundException('Invitation not found');
      const now = new Date();
      if (invitation.status !== 'pending' || invitation.expiresAt <= now)
        throw new ConflictException('Invitation is no longer pending');
      await this.invitations.updateOne(
        { _id: invitationId, status: 'pending' },
        { $set: { status: 'revoked', revokedBy: userId, revokedAt: now } },
        { session },
      );
    });
  }
  async preview(token: string) {
    return this.transactions.run(async (session) => {
      const invitation = await this.pendingInvitation(token, session);
      const space = await this.spaces
        .findOne({ _id: invitation.spaceId, deletedAt: null })
        .select('name')
        .session(session)
        .lean();
      if (!space) throw this.invalid();
      return {
        name: space.name,
        expiresAt: invitation.expiresAt,
      };
    });
  }
  async accept(userId: string, token: string) {
    return this.transactions.run(async (session) => {
      const found = await this.pendingInvitation(token, session);
      const spaceId = String(found.spaceId);
      try {
        await this.access.serializeMutation(spaceId, session);
      } catch (error) {
        if (error instanceof NotFoundException) throw this.invalid();
        throw error;
      }
      const invitation = await this.pendingInvitation(token, session);
      const now = new Date();
      if (
        await this.memberships
          .exists({ spaceId, userId, status: 'active' })
          .session(session)
      )
        throw new ConflictException('Already a space member');
      const result = await this.invitations.updateOne(
        { _id: invitation._id, status: 'pending', expiresAt: { $gt: now } },
        { $set: { status: 'accepted', acceptedBy: userId, acceptedAt: now } },
        { session },
      );
      if (!result.modifiedCount) throw this.invalid();
      await this.memberships.updateOne(
        { spaceId, userId },
        {
          $set: {
            status: 'active',
            joinedAt: now,
            permissions: effectivePermissions(false),
          },
          $unset: { endedAt: 1 },
        },
        { upsert: true, session },
      );
      await this.events.create(
        [{ spaceId, userId, actorId: userId, kind: 'joined', occurredAt: now }],
        { session },
      );
      return { spaceId, role: 'member' as const };
    });
  }
  private async pendingInvitation(token: string, session: ClientSession) {
    const invitation = await this.invitations
      .findOne({
        tokenDigest: this.digest(token),
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
      .session(session);
    if (!invitation) throw this.invalid();
    return invitation;
  }
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private invalid() {
    return new BadRequestException('Invalid invitation');
  }
}
