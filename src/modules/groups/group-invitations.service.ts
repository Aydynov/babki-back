import { effectivePermissions } from './group-permissions';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { getPagination } from '../../common/utils/pagination.util';
import { GroupsAccessService } from './groups-access.service';
import { GroupsTransactionService } from './groups-transaction.service';
import { GroupInvitation } from './schemas/group-invitation.schema';
import { GroupMembership } from './schemas/group-membership.schema';
import { GroupMembershipEvent } from './schemas/group-membership-event.schema';

@Injectable()
export class GroupInvitationsService {
  constructor(
    @InjectModel(GroupInvitation.name)
    private readonly invitations: Model<GroupInvitation>,
    @InjectModel(GroupMembership.name)
    private readonly memberships: Model<GroupMembership>,
    @InjectModel(GroupMembershipEvent.name)
    private readonly events: Model<GroupMembershipEvent>,
    private readonly access: GroupsAccessService,
    private readonly transactions: GroupsTransactionService,
  ) {}
  async create(userId: string, groupId: string) {
    const token = randomBytes(32).toString('base64url');
    return this.transactions.run(async (session) => {
      await this.access.serializeMutation(groupId, session);
      await this.access.requireOwner(groupId, userId, session);
      const expiresAt = new Date(Date.now() + 7 * 86400000);
      const [invitation] = await this.invitations.create(
        [
          {
            groupId,
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
  async findAll(userId: string, groupId: string, query: PaginationQueryDto) {
    await this.access.requireOwner(groupId, userId);
    const { page, limit, skip } = getPagination(query);
    const [records, total] = await Promise.all([
      this.invitations
        .find({ groupId })
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.invitations.countDocuments({ groupId }),
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
  async revoke(userId: string, groupId: string, invitationId: string) {
    await this.transactions.run(async (session) => {
      await this.access.serializeMutation(groupId, session);
      await this.access.requireOwner(groupId, userId, session);
      const invitation = await this.invitations
        .findOne({ _id: invitationId, groupId })
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
  async accept(userId: string, token: string) {
    return this.transactions.run(async (session) => {
      const filter = { tokenDigest: this.digest(token) };
      const found = await this.invitations.findOne(filter).session(session);
      if (!found) throw this.invalid();
      const groupId = String(found.groupId);
      try {
        await this.access.serializeMutation(groupId, session);
      } catch (error) {
        if (error instanceof NotFoundException) throw this.invalid();
        throw error;
      }
      const invitation = await this.invitations
        .findOne(filter)
        .session(session);
      const now = new Date();
      if (
        !invitation ||
        invitation.status !== 'pending' ||
        invitation.expiresAt <= now
      )
        throw this.invalid();
      if (
        await this.memberships
          .exists({ groupId, userId, status: 'active' })
          .session(session)
      )
        throw new ConflictException('Already a group member');
      const result = await this.invitations.updateOne(
        { _id: invitation._id, status: 'pending', expiresAt: { $gt: now } },
        { $set: { status: 'accepted', acceptedBy: userId, acceptedAt: now } },
        { session },
      );
      if (!result.modifiedCount) throw this.invalid();
      await this.memberships.updateOne(
        { groupId, userId },
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
        [{ groupId, userId, actorId: userId, kind: 'joined', occurredAt: now }],
        { session },
      );
      return { groupId, role: 'member' as const };
    });
  }
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private invalid() {
    return new BadRequestException('Invalid invitation');
  }
}
