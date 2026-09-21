import { effectivePermissions, GroupPermission } from './group-permissions';
export type { GroupPermission, GroupPermissions } from './group-permissions';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Group } from './schemas/group.schema';
import { GroupMembership } from './schemas/group-membership.schema';

@Injectable()
export class GroupsAccessService {
  constructor(
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(GroupMembership.name)
    private readonly memberships: Model<GroupMembership>,
  ) {}
  async requireMember(
    groupId: string,
    userId: string,
    session?: ClientSession,
  ) {
    const group = await this.groups
      .findOne({ _id: groupId, deletedAt: null })
      .session(session ?? null);
    if (
      !group ||
      !(await this.memberships
        .exists({ groupId, userId, status: 'active' })
        .session(session ?? null))
    )
      throw new NotFoundException('Group not found');
    return group;
  }
  async requireOwner(groupId: string, userId: string, session?: ClientSession) {
    const group = await this.requireMember(groupId, userId, session);
    if (String(group.ownerId).toLowerCase() !== userId.toLowerCase())
      throw new ForbiddenException('Group owner required');
    return group;
  }
  async requirePermission(
    groupId: string,
    userId: string,
    permission: GroupPermission,
    session?: ClientSession,
  ) {
    const group = await this.requireMember(groupId, userId, session);
    const membership = await this.memberships
      .findOne({ groupId, userId, status: 'active' })
      .session(session ?? null);
    if (!membership) throw new NotFoundException('Group not found');
    if (
      !effectivePermissions(
        group.ownerId.equals(userId),
        membership.permissions,
      )[permission]
    )
      throw new ForbiddenException('Group permission required');
    return group;
  }
  async serializeMutation(groupId: string, session: ClientSession) {
    const group = await this.groups.findOneAndUpdate(
      { _id: groupId, deletedAt: null },
      { $inc: { mutationVersion: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }
}
