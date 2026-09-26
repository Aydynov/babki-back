import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { CurrentUser } from 'src/modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/modules/auth/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { FindAccountQueryDto } from '../dto/find-query.dto';
import { CreateAccountDto } from '../dto/create.dto';
import { UpdateAccountDto } from '../dto/update-account.dto';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  findByParams(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() findQueryDto: FindAccountQueryDto,
  ) {
    return this.accountsService.findByParams(currentUser.userId, findQueryDto);
  }

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountsService.create(currentUser.userId, dto);
  }

  @Get(':accountId')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('accountId', ParseObjectIdPipe) accountId: string,
  ) {
    return this.accountsService.findOne(currentUser.userId, accountId);
  }

  @Patch(':accountId')
  rename(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('accountId', ParseObjectIdPipe) accountId: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountsService.rename(currentUser.userId, accountId, dto.name);
  }

  @Delete(':accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('accountId', ParseObjectIdPipe) accountId: string,
  ) {
    return this.accountsService.deleteEntity(currentUser.userId, accountId);
  }

  @Post(':accountId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('accountId', ParseObjectIdPipe) accountId: string,
  ) {
    return this.accountsService.archive(currentUser.userId, accountId);
  }
}
