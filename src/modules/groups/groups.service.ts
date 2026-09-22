import { effectivePermissions, GroupPermissions } from './group-permissions';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { getPagination } from '../../common/utils/pagination.util';
import { User } from '../users/schemas/user.schema';
import {
  CreateGroupDto,
  UpdateGroupDto,
  UpdateGroupPermissionsDto,
} from './dto/groups.dto';
import { GroupsAccessService } from './groups-access.service';
import { GroupsTransactionService } from './groups-transaction.service';
import { Group, GroupDocument } from './schemas/group.schema';
import { GroupMembership } from './schemas/group-membership.schema';
import { GroupMembershipEvent } from './schemas/group-membership-event.schema';
import { GroupInvitation } from './schemas/group-invitation.schema';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(GroupMembership.name)
    private readonly memberships: Model<GroupMembership>,
    @InjectModel(GroupMembershipEvent.name)
    private readonly events: Model<GroupMembershipEvent>,
    @InjectModel(GroupInvitation.name)
    private readonly invitations: Model<GroupInvitation>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly access: GroupsAccessService,
    private readonly transactions: GroupsTransactionService,
  ) {}
  toDto(group: GroupDocument, userId: string) {
    return {
      id: String(group._id),
      name: group.name,
      type: group.type,
      ...(group.description !== undefined
        ? { description: group.description }
        : {}),
      ownerId: String(group.ownerId),
      role: String(group.ownerId) === userId ? 'owner' : 'member',
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }
  async create(userId: string, dto: CreateGroupDto) {
    return this.transactions.run(async (session) => {
      const now = new Date();
      const [group] = await this.groups.create([{ ...dto, ownerId: userId }], {
        session,
      });
      await this.memberships.create(
        [{ groupId: group._id, userId, status: 'active', joinedAt: now }],
        { session },
      );
      await this.event(
        String(group._id),
        userId,
        userId,
        'joined',
        session,
        now,
      );
      return this.toDto(group, userId);
    });
  }
  async findAll(userId: string, query: PaginationQueryDto) {
    const { page, limit, skip } = getPagination(query);
    const memberships = await this.memberships
      .find({ userId, status: 'active' })
      .select('groupId')
      .lean();
    const filter = {
      _id: { $in: memberships.map((m) => m.groupId) },
      deletedAt: null,
    };
    const [groups, total] = await Promise.all([
      this.groups
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit),
      this.groups.countDocuments(filter),
    ]);
    return {
      items: groups.map((group) => this.toDto(group, userId)),
      total,
      page,
      limit,
    };
  }
  async findOne(userId: string, groupId: string) {
    return this.toDto(await this.access.requireMember(groupId, userId), userId);
  }
  async update(userId: string, groupId: string, dto: UpdateGroupDto) {
    if (dto.name === undefined && dto.description === undefined)
      throw new BadRequestException('At least one update is required');
    return this.mutate(userId, groupId, true, async (group, session) => {
      if (dto.name !== undefined) group.name = dto.name;
      if (dto.description !== undefined) group.description = dto.description;
      await group.save({ session });
      return this.toDto(group, userId);
    });
  }
  async remove(userId: string, groupId: string) {
    await this.mutate(userId, groupId, true, async (group, session) => {
      const now = new Date();
      group.deletedAt = now;
      await group.save({ session });
      await this.memberships.updateMany(
        { groupId, status: 'active' },
        {
          $set: {
            status: 'removed',
            endedAt: now,
            endReason: 'group_deleted',
          },
        },
        { session },
      );
      await this.invitations.updateMany(
        { groupId, status: 'pending' },
        {
          $set: {
            status: 'revoked',
            revokedAt: now,
            revokedBy: new Types.ObjectId(userId),
            revocationReason: 'group_deleted',
          },
        },
        { session },
      );
      await this.event(groupId, userId, userId, 'group-deleted', session, now);
    });
  }
  async members(userId: string, groupId: string, query: PaginationQueryDto) {
    const group = await this.access.requireMember(groupId, userId);
    const { page, limit, skip } = getPagination(query);
    const filter = { groupId, status: 'active' };
    const [memberships, total] = await Promise.all([
      this.memberships
        .find(filter)
        .sort({ joinedAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.memberships.countDocuments(filter),
    ]);
    const users = await this.users
      .find({ _id: { $in: memberships.map((m) => m.userId) } })
      .select('firstName lastName')
      .lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    const items = memberships.map((m) => {
      const user = byId.get(String(m.userId));
      return {
        userId: String(m.userId),
        firstName: user?.firstName,
        ...(user?.lastName !== undefined ? { lastName: user.lastName } : {}),
        role: String(group.ownerId) === String(m.userId) ? 'owner' : 'member',
        joinedAt: m.joinedAt,
        permissions: effectivePermissions(
          group.ownerId.equals(m.userId),
          m.permissions,
        ),
      };
    });
    return { items, total, page, limit };
  }
  async updatePermissions(
    actorId: string,
    groupId: string,
    userId: string,
    dto: UpdateGroupPermissionsDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException('At least one permission is required');
    return this.mutate(actorId, groupId, true, async (group, session) => {
      if (group.ownerId.equals(userId))
        throw new ConflictException('Cannot change owner permissions');
      const member = await this.memberships
        .findOne({ groupId, userId, status: 'active' })
        .session(session);
      if (!member) throw new NotFoundException('Member not found');
      const before = effectivePermissions(false, member.permissions);
      const after = { ...before };
      for (const key of Object.keys(before) as (keyof GroupPermissions)[]) {
        if (dto[key] !== undefined) after[key] = dto[key] as boolean;
      }
      member.permissions = after;
      await member.save({ session });
      await this.event(
        groupId,
        userId,
        actorId,
        'permissions-updated',
        session,
        new Date(),
        { before, after },
      );
      return after;
    });
  }
  async leave(userId: string, groupId: string) {
    await this.mutate(userId, groupId, false, async (group, session) => {
      if (group.ownerId.equals(userId))
        throw new ConflictException('Transfer ownership before leaving');
      const now = new Date();
      const before = await this.resetPermissions(groupId, userId, session);
      await this.memberships.updateOne(
        { groupId, userId, status: 'active' },
        {
          $set: {
            status: 'left',
            endedAt: now,
            endReason: 'member_left',
          },
        },
        { session },
      );
      await this.event(groupId, userId, userId, 'left', session, now, {
        before,
        after: effectivePermissions(false),
      });
    });
  }
  async removeMember(actorId: string, groupId: string, userId: string) {
    await this.mutate(actorId, groupId, true, async (group, session) => {
      if (group.ownerId.equals(userId))
        throw new ConflictException('Cannot remove the owner');
      const now = new Date();
      const before = await this.resetPermissions(groupId, userId, session);
      const result = await this.memberships.updateOne(
        { groupId, userId, status: 'active' },
        {
          $set: {
            status: 'removed',
            endedAt: now,
            endReason: 'member_removed',
          },
        },
        { session },
      );
      if (!result.matchedCount) throw new NotFoundException('Member not found');
      await this.event(groupId, userId, actorId, 'removed', session, now, {
        before,
        after: effectivePermissions(false),
      });
    });
  }
  async transferOwnership(actorId: string, groupId: string, userId: string) {
    return this.mutate(actorId, groupId, true, async (group, session) => {
      if (group.ownerId.equals(userId))
        throw new ConflictException('Already the owner');
      if (
        !(await this.memberships
          .exists({ groupId, userId, status: 'active' })
          .session(session))
      )
        throw new NotFoundException('Member not found');
      const previousPermissions = await this.resetPermissions(
        groupId,
        actorId,
        session,
      );
      const nextPermissions = await this.resetPermissions(
        groupId,
        userId,
        session,
      );
      group.ownerId = new Types.ObjectId(userId);
      await group.save({ session });
      await this.events.create(
        [
          {
            groupId,
            userId,
            actorId,
            kind: 'ownership-transferred',
            occurredAt: new Date(),
            permissionResets: [
              {
                userId: actorId,
                before: previousPermissions,
                after: effectivePermissions(false),
              },
              {
                userId,
                before: nextPermissions,
                after: effectivePermissions(false),
              },
            ],
            previousOwnerId: actorId,
            newOwnerId: userId,
          },
        ],
        { session },
      );
      return this.toDto(group, actorId);
    });
  }
  private async resetPermissions(
    groupId: string,
    userId: string,
    session: ClientSession,
  ) {
    const member = await this.memberships
      .findOne({ groupId, userId, status: 'active' })
      .session(session);
    if (!member) throw new NotFoundException('Member not found');
    const before = effectivePermissions(false, member.permissions);
    member.permissions = effectivePermissions(false);
    await member.save({ session });
    return before;
  }
  private mutate<T>(
    userId: string,
    groupId: string,
    ownerOnly: boolean,
    callback: (group: GroupDocument, session: ClientSession) => Promise<T>,
  ) {
    return this.transactions.run(async (session) => {
      await this.access.serializeMutation(groupId, session);
      const group = await (ownerOnly
        ? this.access.requireOwner(groupId, userId, session)
        : this.access.requireMember(groupId, userId, session));
      return callback(group, session);
    });
  }
  private async event(
    groupId: string,
    userId: string,
    actorId: string,
    kind: string,
    session: ClientSession,
    occurredAt: Date,
    permissions?: { before: GroupPermissions; after: GroupPermissions },
  ) {
    await this.events.create(
      [
        {
          groupId,
          userId,
          targetUserId: userId,
          actorId,
          kind,
          occurredAt,
          ...permissions,
        },
      ],
      {
        session,
      },
    );
  }
}
