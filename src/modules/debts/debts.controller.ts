import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CreateDebtDto } from './dto/create-debt.dto';
import { ListDebtsQueryDto } from './dto/list-debts-query.dto';
import { RepayDebtDto } from './dto/repay-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { DebtsService } from './debts.service';

@Controller('debts')
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() createDebtDto: CreateDebtDto,
  ) {
    return this.debtsService.create(currentUser.userId, createDebtDto);
  }

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListDebtsQueryDto,
  ) {
    return this.debtsService.findAll(currentUser.userId, query);
  }

  @Get(':debtId')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('debtId', ParseObjectIdPipe) debtId: string,
  ) {
    return this.debtsService.findOne(currentUser.userId, debtId);
  }

  @Patch(':debtId')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('debtId', ParseObjectIdPipe) debtId: string,
    @Body() updateDebtDto: UpdateDebtDto,
  ) {
    return this.debtsService.update(currentUser.userId, debtId, updateDebtDto);
  }

  @Post(':debtId/repayments')
  repay(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('debtId', ParseObjectIdPipe) debtId: string,
    @Body() repayDebtDto: RepayDebtDto,
  ) {
    return this.debtsService.repay(currentUser.userId, debtId, repayDebtDto);
  }

  @Delete(':debtId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('debtId', ParseObjectIdPipe) debtId: string,
  ) {
    return this.debtsService.remove(currentUser.userId, debtId);
  }

  @Post(':debtId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('debtId', ParseObjectIdPipe) debtId: string,
  ) {
    return this.debtsService.archive(currentUser.userId, debtId);
  }
}
