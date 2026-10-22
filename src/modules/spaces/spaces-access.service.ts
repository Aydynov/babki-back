import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { SpaceMembership } from './schemas/space-membership.schema';
import { Space } from './schemas/space.schema';
import { effectivePermissions, SpacePermission } from './space-permissions';
export type { SpacePermission, SpacePermissions } from './space-permissions';
@Injectable()
export class SpacesAccessService {
  constructor(
    @InjectModel(Space.name)
    private readonly spaces: Model<Space>,
    @InjectModel(SpaceMembership.name)
    private readonly memberships: Model<SpaceMembership>,
  ) {}
  async requireMember(
    spaceId: string,
    userId: string,
    session?: ClientSession,
  ) {
    const space = await this.spaces
      .findOne({ _id: spaceId, deletedAt: null })
      .session(session ?? null);
    if (
      !space ||
      !(await this.memberships
        .exists({ spaceId, userId, status: 'active' })
        .session(session ?? null))
    )
      throw new NotFoundException('Space not found');
    return space;
  }
  async requireOwner(spaceId: string, userId: string, session?: ClientSession) {
    const space = await this.requireMember(spaceId, userId, session);
    if (String(space.ownerId).toLowerCase() !== userId.toLowerCase())
      throw new ForbiddenException('Space owner required');
    return space;
  }
  async requirePermission(
    spaceId: string,
    userId: string,
    permission: SpacePermission,
    session?: ClientSession,
  ) {
    const { space, permissions } = await this.memberContext(
      spaceId,
      userId,
      session,
    );
    if (!permissions[permission])
      throw new ForbiddenException('Space permission required');
    return space;
  }
  async memberContext(
    spaceId: string,
    userId: string,
    session?: ClientSession,
  ) {
    const space = await this.requireMember(spaceId, userId, session);
    const membership = await this.memberships
      .findOne({ spaceId, userId, status: 'active' })
      .session(session ?? null);
    if (!membership) throw new NotFoundException('Space not found');
    return {
      space,
      permissions: effectivePermissions(
        space.ownerId.equals(userId),
        membership.permissions,
      ),
    };
  }
  async serializeMutation(spaceId: string, session: ClientSession) {
    const space = await this.spaces.findOneAndUpdate(
      { _id: spaceId, deletedAt: null },
      { $inc: { mutationVersion: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }
}
