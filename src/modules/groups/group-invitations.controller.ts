import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AcceptGroupInvitationDto, EmptyGroupBodyDto } from './dto/groups.dto';
import { GroupInvitationsService } from './group-invitations.service';
import { GroupInvitationRateLimitGuard } from './group-invitation-rate-limit.guard';

@Controller('group-invitations')
export class GroupInvitationsController {
  constructor(private readonly invitations: GroupInvitationsService) {}
  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(GroupInvitationRateLimitGuard)
  preview(
    @CurrentUser() _user: AuthenticatedUser,
    @Body() dto: AcceptGroupInvitationDto,
    @Query() _query: EmptyGroupBodyDto,
  ) {
    return this.invitations.preview(dto.token);
  }
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
