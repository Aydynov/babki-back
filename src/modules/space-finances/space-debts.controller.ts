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
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  CreateSpaceDebtDto,
  RepaySpaceDebtDto,
  SpaceDebtsQueryDto,
  UpdateSpaceDebtDto,
} from './dto/space-debts.dto';
import { EmptySpaceQueryDto } from './dto/space-finances.dto';
import { SpaceDebtsService } from './space-debts.service';
import { SpaceFinancialResponseInterceptor } from './space-financial-response.interceptor';
@UseInterceptors(SpaceFinancialResponseInterceptor)
@Controller('spaces/:spaceId/debts')
export class SpaceDebtsController {
  constructor(private readonly debts: SpaceDebtsService) {}
  @Post()
  create(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    dto: CreateSpaceDebtDto,
  ) {
    return this.debts.create(spaceId, user.userId, dto);
  }
  @Get()
  list(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceDebtsQueryDto,
  ) {
    return this.debts.list(spaceId, user.userId, query);
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
    return this.debts.get(spaceId, user.userId, id);
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
    dto: UpdateSpaceDebtDto,
  ) {
    return this.debts.update(spaceId, user.userId, id, dto);
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
    await this.debts.remove(spaceId, user.userId, id);
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
    await this.debts.archive(spaceId, user.userId, id);
  }
  @Get(':id/repayments')
  history(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: PaginationQueryDto,
  ) {
    return this.debts.repayments(spaceId, user.userId, id, query);
  }
  @Get(':id/repayments/:repaymentId')
  repayment(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Param('repaymentId', ParseObjectIdPipe)
    repaymentId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
  ) {
    return this.debts.repayment(spaceId, user.userId, id, repaymentId);
  }
  @Post(':id/repayments')
  repay(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    dto: RepaySpaceDebtDto,
  ) {
    return this.debts.repay(spaceId, user.userId, id, dto);
  }
  @Post(':id/repayments/:repaymentId/cancel')
  @HttpCode(200)
  cancel(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Param('repaymentId', ParseObjectIdPipe)
    repaymentId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    _body: EmptySpaceQueryDto,
  ) {
    return this.debts.cancel(spaceId, user.userId, id, repaymentId);
  }
}
