import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { CurrentUser } from 'src/modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/modules/auth/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly accountsTransactionsService: TransactionsService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.accountsTransactionsService.findAll(currentUser.userId, query);
  }

  @Get(':transactionId')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('transactionId', ParseObjectIdPipe)
    transactionId: string,
  ) {
    return this.accountsTransactionsService.findOne(
      currentUser.userId,
      transactionId,
    );
  }

  @Delete(':transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('transactionId', ParseObjectIdPipe)
    transactionId: string,
  ) {
    return this.accountsTransactionsService.delete(
      currentUser.userId,
      transactionId,
    );
  }
}
