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
import { AcceptSpaceInvitationDto, EmptySpaceBodyDto } from './dto/spaces.dto';
import { SpaceInvitationRateLimitGuard } from './space-invitation-rate-limit.guard';
import { SpaceInvitationsService } from './space-invitations.service';
@Controller('space-invitations')
export class SpaceInvitationsController {
  constructor(private readonly invitations: SpaceInvitationsService) {}
  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(SpaceInvitationRateLimitGuard)
  preview(
    @CurrentUser()
    _user: AuthenticatedUser,
    @Body()
    dto: AcceptSpaceInvitationDto,
    @Query()
    _query: EmptySpaceBodyDto,
  ) {
    return this.invitations.preview(dto.token);
  }
  @Post('accept')
  @HttpCode(200)
  @UseGuards(SpaceInvitationRateLimitGuard)
  accept(
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: AcceptSpaceInvitationDto,
  ) {
    return this.invitations.accept(user.userId, dto.token);
  }
}
