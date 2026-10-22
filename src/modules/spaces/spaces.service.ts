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
  CreateSpaceDto,
  UpdateSpaceDto,
  UpdateSpacePermissionsDto,
} from './dto/spaces.dto';
import { SpaceInvitation } from './schemas/space-invitation.schema';
import { SpaceMembershipEvent } from './schemas/space-membership-event.schema';
import { SpaceMembership } from './schemas/space-membership.schema';
import { Space, SpaceDocument } from './schemas/space.schema';
import { effectivePermissions, SpacePermissions } from './space-permissions';
import { SpacesAccessService } from './spaces-access.service';
import { SpacesTransactionService } from './spaces-transaction.service';
@Injectable()
export class SpacesService {
  constructor(
    @InjectModel(Space.name)
    private readonly spaces: Model<Space>,
    @InjectModel(SpaceMembership.name)
    private readonly memberships: Model<SpaceMembership>,
    @InjectModel(SpaceMembershipEvent.name)
    private readonly events: Model<SpaceMembershipEvent>,
    @InjectModel(SpaceInvitation.name)
    private readonly invitations: Model<SpaceInvitation>,
    @InjectModel(User.name)
    private readonly users: Model<User>,
    private readonly access: SpacesAccessService,
    private readonly transactions: SpacesTransactionService,
  ) {}
  toDto(space: SpaceDocument, userId: string, permissions: SpacePermissions) {
    return {
      id: String(space._id),
      name: space.name,
      ...(space.description !== undefined
        ? { description: space.description }
        : {}),
      ownerId: String(space.ownerId),
      role: space.ownerId.equals(userId) ? 'owner' : 'member',
      permissions,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
    };
  }
  async create(userId: string, dto: CreateSpaceDto) {
    return this.transactions.run(async (session) => {
      const now = new Date();
      const [space] = await this.spaces.create([{ ...dto, ownerId: userId }], {
        session,
      });
      await this.memberships.create(
        [{ spaceId: space._id, userId, status: 'active', joinedAt: now }],
        { session },
      );
      await this.event(
        String(space._id),
        userId,
        userId,
        'joined',
        session,
        now,
      );
      return this.toDto(space, userId, effectivePermissions(true));
    });
  }
  async findAll(userId: string, query: PaginationQueryDto) {
    const { page, limit, skip } = getPagination(query);
    const memberships = await this.memberships
      .find({ userId, status: 'active' })
      .select('spaceId permissions')
      .lean();
    const bySpace = new Map(
      memberships.map((m) => [String(m.spaceId), m.permissions]),
    );
    const filter = {
      _id: { $in: memberships.map((m) => m.spaceId) },
      deletedAt: null,
    };
    const [spaces, total] = await Promise.all([
      this.spaces
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit),
      this.spaces.countDocuments(filter),
    ]);
    return {
      items: spaces.map((space) =>
        this.toDto(
          space,
          userId,
          effectivePermissions(
            space.ownerId.equals(userId),
            bySpace.get(String(space._id)),
          ),
        ),
      ),
      total,
      page,
      limit,
    };
  }
  async findOne(userId: string, spaceId: string) {
    const { space, permissions } = await this.access.memberContext(
      spaceId,
      userId,
    );
    return this.toDto(space, userId, permissions);
  }
  async update(userId: string, spaceId: string, dto: UpdateSpaceDto) {
    if (dto.name === undefined && dto.description === undefined)
      throw new BadRequestException('At least one update is required');
    return this.mutate(userId, spaceId, true, async (space, session) => {
      if (dto.name !== undefined) space.name = dto.name;
      if (dto.description !== undefined) space.description = dto.description;
      await space.save({ session });
      return this.toDto(space, userId, effectivePermissions(true));
    });
  }
  async remove(userId: string, spaceId: string) {
    await this.mutate(userId, spaceId, true, async (space, session) => {
      const now = new Date();
      space.deletedAt = now;
      await space.save({ session });
      await this.memberships.updateMany(
        { spaceId, status: 'active' },
        {
          $set: {
            status: 'removed',
            endedAt: now,
            endReason: 'space_deleted',
          },
        },
        { session },
      );
      await this.invitations.updateMany(
        { spaceId, status: 'pending' },
        {
          $set: {
            status: 'revoked',
            revokedAt: now,
            revokedBy: new Types.ObjectId(userId),
            revocationReason: 'space_deleted',
          },
        },
        { session },
      );
      await this.event(spaceId, userId, userId, 'space-deleted', session, now);
    });
  }
  async members(userId: string, spaceId: string, query: PaginationQueryDto) {
    const space = await this.access.requireMember(spaceId, userId);
    const { page, limit, skip } = getPagination(query);
    const filter = { spaceId, status: 'active' };
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
        role: String(space.ownerId) === String(m.userId) ? 'owner' : 'member',
        joinedAt: m.joinedAt,
        permissions: effectivePermissions(
          space.ownerId.equals(m.userId),
          m.permissions,
        ),
      };
    });
    return { items, total, page, limit };
  }
  async updatePermissions(
    actorId: string,
    spaceId: string,
    userId: string,
    dto: UpdateSpacePermissionsDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined))
      throw new BadRequestException('At least one permission is required');
    return this.mutate(actorId, spaceId, true, async (space, session) => {
      if (space.ownerId.equals(userId))
        throw new ConflictException('Cannot change owner permissions');
      const member = await this.memberships
        .findOne({ spaceId, userId, status: 'active' })
        .session(session);
      if (!member) throw new NotFoundException('Member not found');
      const before = effectivePermissions(false, member.permissions);
      const after = { ...before };
      for (const key of Object.keys(before) as (keyof SpacePermissions)[]) {
        if (dto[key] !== undefined) after[key] = dto[key] as boolean;
      }
      member.permissions = after;
      await member.save({ session });
      await this.event(
        spaceId,
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
  async leave(userId: string, spaceId: string) {
    await this.mutate(userId, spaceId, false, async (space, session) => {
      if (space.ownerId.equals(userId))
        throw new ConflictException('Transfer ownership before leaving');
      const now = new Date();
      const before = await this.resetPermissions(spaceId, userId, session);
      await this.memberships.updateOne(
        { spaceId, userId, status: 'active' },
        {
          $set: {
            status: 'left',
            endedAt: now,
            endReason: 'member_left',
          },
        },
        { session },
      );
      await this.event(spaceId, userId, userId, 'left', session, now, {
        before,
        after: effectivePermissions(false),
      });
    });
  }
  async removeMember(actorId: string, spaceId: string, userId: string) {
    await this.mutate(actorId, spaceId, true, async (space, session) => {
      if (space.ownerId.equals(userId))
        throw new ConflictException('Cannot remove the owner');
      const now = new Date();
      const before = await this.resetPermissions(spaceId, userId, session);
      const result = await this.memberships.updateOne(
        { spaceId, userId, status: 'active' },
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
      await this.event(spaceId, userId, actorId, 'removed', session, now, {
        before,
        after: effectivePermissions(false),
      });
    });
  }
  async transferOwnership(actorId: string, spaceId: string, userId: string) {
    return this.mutate(actorId, spaceId, true, async (space, session) => {
      if (space.ownerId.equals(userId))
        throw new ConflictException('Already the owner');
      if (
        !(await this.memberships
          .exists({ spaceId, userId, status: 'active' })
          .session(session))
      )
        throw new NotFoundException('Member not found');
      const previousPermissions = await this.resetPermissions(
        spaceId,
        actorId,
        session,
      );
      const nextPermissions = await this.resetPermissions(
        spaceId,
        userId,
        session,
      );
      space.ownerId = new Types.ObjectId(userId);
      await space.save({ session });
      await this.events.create(
        [
          {
            spaceId,
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
      return this.toDto(space, actorId, effectivePermissions(false));
    });
  }
  private async resetPermissions(
    spaceId: string,
    userId: string,
    session: ClientSession,
  ) {
    const member = await this.memberships
      .findOne({ spaceId, userId, status: 'active' })
      .session(session);
    if (!member) throw new NotFoundException('Member not found');
    const before = effectivePermissions(false, member.permissions);
    member.permissions = effectivePermissions(false);
    await member.save({ session });
    return before;
  }
  private mutate<T>(
    userId: string,
    spaceId: string,
    ownerOnly: boolean,
    callback: (space: SpaceDocument, session: ClientSession) => Promise<T>,
  ) {
    return this.transactions.run(async (session) => {
      await this.access.serializeMutation(spaceId, session);
      const space = await (ownerOnly
        ? this.access.requireOwner(spaceId, userId, session)
        : this.access.requireMember(spaceId, userId, session));
      return callback(space, session);
    });
  }
  private async event(
    spaceId: string,
    userId: string,
    actorId: string,
    kind: string,
    session: ClientSession,
    occurredAt: Date,
    permissions?: {
      before: SpacePermissions;
      after: SpacePermissions;
    },
  ) {
    await this.events.create(
      [
        {
          spaceId,
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
