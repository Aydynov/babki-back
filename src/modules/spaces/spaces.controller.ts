import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  CreateSpaceDto,
  EmptySpaceBodyDto,
  TransferOwnershipDto,
  UpdateSpaceDto,
  UpdateSpacePermissionsDto,
} from './dto/spaces.dto';
import { SpaceInvitationsService } from './space-invitations.service';
import { SpacesService } from './spaces.service';
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly invitations: SpaceInvitationsService,
  ) {}
  @Post()
  create(
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceDto,
  ) {
    return this.spaces.create(user.userId, dto);
  }
  @Get()
  list(
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: PaginationQueryDto,
  ) {
    return this.spaces.findAll(user.userId, query);
  }
  @Get(':spaceId')
  get(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
  ) {
    return this.spaces.findOne(user.userId, id);
  }
  @Patch(':spaceId')
  update(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: UpdateSpaceDto,
  ) {
    return this.spaces.update(user.userId, id, dto);
  }
  @Delete(':spaceId')
  @HttpCode(204)
  remove(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
  ) {
    return this.spaces.remove(user.userId, id);
  }
  @Get(':spaceId/members')
  members(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Query()
    query: PaginationQueryDto,
  ) {
    return this.spaces.members(user.userId, id, query);
  }
  @Patch(':spaceId/members/:userId/permissions')
  permissions(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Param('userId', ParseObjectIdPipe)
    userId: string,
    @Body()
    dto: UpdateSpacePermissionsDto,
  ) {
    return this.spaces.updatePermissions(user.userId, id, userId, dto);
  }
  @Post(':spaceId/leave')
  @HttpCode(204)
  leave(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Body()
    _dto: EmptySpaceBodyDto,
  ) {
    return this.spaces.leave(user.userId, id);
  }
  @Delete(':spaceId/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Param('userId', ParseObjectIdPipe)
    userId: string,
  ) {
    return this.spaces.removeMember(user.userId, id, userId);
  }
  @Post(':spaceId/ownership')
  @HttpCode(200)
  ownership(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: TransferOwnershipDto,
  ) {
    return this.spaces.transferOwnership(user.userId, id, dto.userId);
  }
  @Post(':spaceId/invitations')
  invite(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Body()
    _dto: EmptySpaceBodyDto,
  ) {
    return this.invitations.create(user.userId, id);
  }
  @Get(':spaceId/invitations')
  listInvitations(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Query()
    query: PaginationQueryDto,
  ) {
    return this.invitations.findAll(user.userId, id, query);
  }
  @Delete(':spaceId/invitations/:invitationId')
  @HttpCode(204)
  revoke(
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('spaceId', ParseObjectIdPipe)
    id: string,
    @Param('invitationId', ParseObjectIdPipe)
    invitationId: string,
  ) {
    return this.invitations.revoke(user.userId, id, invitationId);
  }
}
