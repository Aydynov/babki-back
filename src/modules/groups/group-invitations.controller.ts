import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AcceptGroupInvitationDto } from './dto/groups.dto';
import { GroupInvitationsService } from './group-invitations.service';
import { GroupInvitationRateLimitGuard } from './group-invitation-rate-limit.guard';

@Controller('group-invitations')
export class GroupInvitationsController {
  constructor(private readonly invitations: GroupInvitationsService) {}
  @Post('accept')
  @HttpCode(200)
  @UseGuards(GroupInvitationRateLimitGuard)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptGroupInvitationDto,
  ) {
    return this.invitations.accept(user.userId, dto.token);
  }
}
