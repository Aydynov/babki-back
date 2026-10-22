import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  SpaceInvitationRateLimit,
  SpaceInvitationRateLimitSchema,
} from './schemas/space-invitation-rate-limit.schema';
import {
  SpaceInvitation,
  SpaceInvitationSchema,
} from './schemas/space-invitation.schema';
import {
  SpaceMembershipEvent,
  SpaceMembershipEventSchema,
} from './schemas/space-membership-event.schema';
import {
  SpaceMembership,
  SpaceMembershipSchema,
} from './schemas/space-membership.schema';
import { Space, SpaceSchema } from './schemas/space.schema';
import { SpaceInvitationRateLimitGuard } from './space-invitation-rate-limit.guard';
import { SpaceInvitationsController } from './space-invitations.controller';
import { SpaceInvitationsService } from './space-invitations.service';
import { SpacesAccessService } from './spaces-access.service';
import { SpacesTransactionService } from './spaces-transaction.service';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Space.name, schema: SpaceSchema },
      { name: SpaceMembership.name, schema: SpaceMembershipSchema },
      { name: SpaceMembershipEvent.name, schema: SpaceMembershipEventSchema },
      { name: SpaceInvitation.name, schema: SpaceInvitationSchema },
      {
        name: SpaceInvitationRateLimit.name,
        schema: SpaceInvitationRateLimitSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SpacesController, SpaceInvitationsController],
  providers: [
    SpacesService,
    SpacesAccessService,
    SpacesTransactionService,
    SpaceInvitationsService,
    SpaceInvitationRateLimitGuard,
  ],
  exports: [SpacesAccessService],
})
export class SpacesModule implements OnModuleInit {
  constructor(
    @InjectModel(Space.name)
    private readonly spaces: Model<Space>,
    @InjectModel(SpaceMembership.name)
    private readonly memberships: Model<SpaceMembership>,
    @InjectModel(SpaceMembershipEvent.name)
    private readonly events: Model<SpaceMembershipEvent>,
    @InjectModel(SpaceInvitation.name)
    private readonly invitations: Model<SpaceInvitation>,
    @InjectModel(SpaceInvitationRateLimit.name)
    private readonly rateLimits: Model<SpaceInvitationRateLimit>,
  ) {}
  async onModuleInit() {
    // Await index creation before Nest begins serving space routes.
    await this.spaces.createIndexes();
    await this.memberships.createIndexes();
    await this.events.createIndexes();
    await this.invitations.createIndexes();
    await this.rateLimits.createIndexes();
  }
}
