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
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { EmptyGroupQueryDto } from './dto/group-finances.dto';
import {
  CreateGroupDebtDto,
  GroupDebtsQueryDto,
  RepayGroupDebtDto,
  UpdateGroupDebtDto,
} from './dto/group-debts.dto';
import { GroupDebtsService } from './group-debts.service';

@Controller('groups/:groupId/debts')
export class GroupDebtsController {
  constructor(private readonly debts: GroupDebtsService) {}

  @Post()
  create(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() dto: CreateGroupDebtDto,
  ) {
    return this.debts.create(groupId, user.userId, dto);
  }

  @Get()
  list(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupDebtsQueryDto,
  ) {
    return this.debts.list(groupId, user.userId, query);
  }

  @Get(':id')
  get(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
  ) {
    return this.debts.get(groupId, user.userId, id);
  }

  @Patch(':id')
  update(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() dto: UpdateGroupDebtDto,
  ) {
    return this.debts.update(groupId, user.userId, id, dto);
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
    await this.debts.remove(groupId, user.userId, id);
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
    await this.debts.archive(groupId, user.userId, id);
  }

  @Get(':id/repayments')
  history(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.debts.repayments(groupId, user.userId, id, query);
  }

  @Get(':id/repayments/:repaymentId')
  repayment(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('repaymentId', ParseObjectIdPipe) repaymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
  ) {
    return this.debts.repayment(groupId, user.userId, id, repaymentId);
  }

  @Post(':id/repayments')
  repay(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() dto: RepayGroupDebtDto,
  ) {
    return this.debts.repay(groupId, user.userId, id, dto);
  }

  @Post(':id/repayments/:repaymentId/cancel')
  @HttpCode(200)
  cancel(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('repaymentId', ParseObjectIdPipe) repaymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: EmptyGroupQueryDto,
    @Body() _body: EmptyGroupQueryDto,
  ) {
    return this.debts.cancel(groupId, user.userId, id, repaymentId);
  }
}
