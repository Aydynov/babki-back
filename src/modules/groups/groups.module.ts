import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { GroupsService } from './groups.service';
import { GroupsAccessService } from './groups-access.service';
import { GroupsTransactionService } from './groups-transaction.service';
import { GroupInvitationsService } from './group-invitations.service';
import { GroupInvitationRateLimitGuard } from './group-invitation-rate-limit.guard';
import { GroupsController } from './groups.controller';
import { GroupInvitationsController } from './group-invitations.controller';
import { Group, GroupSchema } from './schemas/group.schema';
import {
  GroupMembership,
  GroupMembershipSchema,
} from './schemas/group-membership.schema';
import {
  GroupMembershipEvent,
  GroupMembershipEventSchema,
} from './schemas/group-membership-event.schema';
import {
  GroupInvitation,
  GroupInvitationSchema,
} from './schemas/group-invitation.schema';
import {
  GroupInvitationRateLimit,
  GroupInvitationRateLimitSchema,
} from './schemas/group-invitation-rate-limit.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: GroupMembership.name, schema: GroupMembershipSchema },
      { name: GroupMembershipEvent.name, schema: GroupMembershipEventSchema },
      { name: GroupInvitation.name, schema: GroupInvitationSchema },
      {
        name: GroupInvitationRateLimit.name,
        schema: GroupInvitationRateLimitSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [GroupsController, GroupInvitationsController],
  providers: [
    GroupsService,
    GroupsAccessService,
    GroupsTransactionService,
    GroupInvitationsService,
    GroupInvitationRateLimitGuard,
  ],
  exports: [GroupsAccessService],
})
export class GroupsModule implements OnModuleInit {
  constructor(
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(GroupMembership.name)
    private readonly memberships: Model<GroupMembership>,
    @InjectModel(GroupMembershipEvent.name)
    private readonly events: Model<GroupMembershipEvent>,
    @InjectModel(GroupInvitation.name)
    private readonly invitations: Model<GroupInvitation>,
    @InjectModel(GroupInvitationRateLimit.name)
    private readonly rateLimits: Model<GroupInvitationRateLimit>,
  ) {}
  async onModuleInit() {
    // Await index creation before Nest begins serving group routes.
    await this.groups.createIndexes();
    await this.memberships.createIndexes();
    await this.events.createIndexes();
    await this.invitations.createIndexes();
    await this.rateLimits.createIndexes();
  }
}
