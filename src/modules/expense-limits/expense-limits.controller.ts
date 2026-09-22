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
import { CreateExpenseLimitDto } from './dto/create.dto';
import { FindExpenseLimitQueryDto } from './dto/find-query.dto';
import { UpdateExpenseLimitDto } from './dto/update.dto';
import { ExpenseLimitsService } from './expense-limits.service';

@Controller('expense-limits')
export class ExpenseLimitsController {
  constructor(private readonly expenseLimitsService: ExpenseLimitsService) {}

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() createExpenseLimitDto: CreateExpenseLimitDto,
  ) {
    return this.expenseLimitsService.create(
      currentUser.userId,
      createExpenseLimitDto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() queryDto: FindExpenseLimitQueryDto,
  ) {
    return this.expenseLimitsService.findAll(currentUser.userId, queryDto);
  }

  @Get(':limitId')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('limitId', ParseObjectIdPipe) limitId: string,
  ) {
    return this.expenseLimitsService.findOne(currentUser.userId, limitId);
  }

  @Patch(':limitId')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('limitId', ParseObjectIdPipe) limitId: string,
    @Body() updateExpenseLimitDto: UpdateExpenseLimitDto,
  ) {
    return this.expenseLimitsService.update(
      currentUser.userId,
      limitId,
      updateExpenseLimitDto,
    );
  }

  @Delete(':limitId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('limitId', ParseObjectIdPipe) limitId: string,
  ) {
    return this.expenseLimitsService.deleteEntity(currentUser.userId, limitId);
  }
}
