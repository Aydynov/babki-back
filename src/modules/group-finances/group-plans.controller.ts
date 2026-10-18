import { GroupFinancialResponseInterceptor } from './group-financial-response.interceptor';
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
  UseInterceptors,
} from '@nestjs/common';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { EmptyGroupQueryDto } from './dto/group-finances.dto';
import {
  CloseGroupPlanDto,
  CreateGroupPlanDto,
  GroupPlansQueryDto,
  UpdateGroupPlanDto,
} from './dto/group-plans.dto';
import { GroupPlansService } from './group-plans.service';

@UseInterceptors(GroupFinancialResponseInterceptor)
@Controller('groups/:groupId/plans')
export class GroupPlansController {
  constructor(private readonly plans: GroupPlansService) {}

  @Post()
  create(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() dto: CreateGroupPlanDto,
  ) {
    return this.plans.create(groupId, user.userId, dto);
  }

  @Get()
  list(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupPlansQueryDto,
  ) {
    return this.plans.list(groupId, user.userId, query);
  }

  @Get(':id')
  get(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
  ) {
    return this.plans.get(groupId, user.userId, id);
  }

  @Patch(':id')
  update(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() dto: UpdateGroupPlanDto,
  ) {
    return this.plans.update(groupId, user.userId, id, dto);
  }

  @Post(':id/close')
  close(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() dto: CloseGroupPlanDto,
  ) {
    return this.plans.close(groupId, user.userId, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(204)
  async archive(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() _body: EmptyGroupQueryDto,
  ) {
    await this.plans.archive(groupId, user.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() _body: EmptyGroupQueryDto,
  ) {
    await this.plans.remove(groupId, user.userId, id);
  }
}
