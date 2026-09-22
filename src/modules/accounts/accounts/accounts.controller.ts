import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from 'src/modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/modules/auth/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { FindAccountQueryDto } from '../dto/find-query.dto';
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
