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
import { EmptySpaceQueryDto } from './dto/space-finances.dto';
import {
  CloseSpacePlanDto,
  CreateSpacePlanDto,
  SpacePlansQueryDto,
  UpdateSpacePlanDto,
} from './dto/space-plans.dto';
import { SpaceFinancialResponseInterceptor } from './space-financial-response.interceptor';
import { SpacePlansService } from './space-plans.service';
@UseInterceptors(SpaceFinancialResponseInterceptor)
@Controller('spaces/:spaceId/plans')
export class SpacePlansController {
  constructor(private readonly plans: SpacePlansService) {}
  @Post()
  create(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    dto: CreateSpacePlanDto,
  ) {
    return this.plans.create(spaceId, user.userId, dto);
  }
  @Get()
  list(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpacePlansQueryDto,
  ) {
    return this.plans.list(spaceId, user.userId, query);
  }
  @Get(':id')
  get(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
  ) {
    return this.plans.get(spaceId, user.userId, id);
  }
  @Patch(':id')
  update(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    dto: UpdateSpacePlanDto,
  ) {
    return this.plans.update(spaceId, user.userId, id, dto);
  }
  @Post(':id/close')
  close(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    dto: CloseSpacePlanDto,
  ) {
    return this.plans.close(spaceId, user.userId, id, dto);
  }
  @Post(':id/archive')
  @HttpCode(204)
  async archive(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    _body: EmptySpaceQueryDto,
  ) {
    await this.plans.archive(spaceId, user.userId, id);
  }
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    _body: EmptySpaceQueryDto,
  ) {
    await this.plans.remove(spaceId, user.userId, id);
  }
}
