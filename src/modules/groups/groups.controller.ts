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
  CreateGroupDto,
  EmptyGroupBodyDto,
  TransferOwnershipDto,
  UpdateGroupDto,
} from './dto/groups.dto';
import { GroupsService } from './groups.service';
import { GroupInvitationsService } from './group-invitations.service';

@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly invitations: GroupInvitationsService,
  ) {}
  @Post() create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupDto,
  ) {
    return this.groups.create(user.userId, dto);
  }
  @Get() list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.groups.findAll(user.userId, query);
  }
  @Get(':groupId') get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
  ) {
    return this.groups.findOne(user.userId, id);
  }
  @Patch(':groupId') update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groups.update(user.userId, id, dto);
  }
  @Delete(':groupId') @HttpCode(204) remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
  ) {
    return this.groups.remove(user.userId, id);
  }
  @Get(':groupId/members') members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.groups.members(user.userId, id, query);
  }
  @Post(':groupId/leave') @HttpCode(204) leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Body() _dto: EmptyGroupBodyDto,
  ) {
    return this.groups.leave(user.userId, id);
  }
  @Delete(':groupId/members/:userId') @HttpCode(204) removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
  ) {
    return this.groups.removeMember(user.userId, id, userId);
  }
  @Post(':groupId/ownership') @HttpCode(200) ownership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.groups.transferOwnership(user.userId, id, dto.userId);
  }
  @Post(':groupId/invitations') invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Body() _dto: EmptyGroupBodyDto,
  ) {
    return this.invitations.create(user.userId, id);
  }
  @Get(':groupId/invitations') listInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.invitations.findAll(user.userId, id, query);
  }
  @Delete(':groupId/invitations/:invitationId') @HttpCode(204) revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseObjectIdPipe) id: string,
    @Param('invitationId', ParseObjectIdPipe) invitationId: string,
  ) {
    return this.invitations.revoke(user.userId, id, invitationId);
  }
}
