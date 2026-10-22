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
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  CreateSpaceAccountDto,
  CreateSpaceCategoryDto,
  CreateSpaceExpenseDto,
  CreateSpaceIncomeDto,
  CreateSpaceLimitDto,
  EmptySpaceQueryDto,
  RenameSpaceAccountDto,
  SpaceAccountsQueryDto,
  SpaceExpensesQueryDto,
  SpaceLimitsQueryDto,
  SpaceReportsQueryDto,
  SpaceTransactionsQueryDto,
  UpdateSpaceCategoryDto,
  UpdateSpaceExpenseDto,
  UpdateSpaceIncomeDto,
  UpdateSpaceLimitDto,
} from './dto/space-finances.dto';
import {
  CreateSpaceTransferDto,
  SpaceTransfersQueryDto,
  UpdateSpaceTransferDto,
} from './dto/space-transfers.dto';
import { SpaceFinancialResponseInterceptor } from './space-financial-response.interceptor';
import { SpaceReportsService } from './space-reports.service';
import { SpaceSettingsService } from './space-settings.service';
import { SpaceTransactionsService } from './space-transactions.service';
import { SpaceTransfersService } from './space-transfers.service';
import { SpaceWalletService } from './space-wallet.service';
@UseInterceptors(SpaceFinancialResponseInterceptor)
@Controller('spaces/:spaceId')
export class SpaceFinancesController {
  constructor(
    private readonly transfers: SpaceTransfersService,
    private readonly wallet: SpaceWalletService,
    private readonly transactions: SpaceTransactionsService,
    private readonly settings: SpaceSettingsService,
    private readonly reports: SpaceReportsService,
  ) {}
  @Get('accounts')
  async accounts(
    @Query()
    query: SpaceAccountsQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.wallet.list(spaceId, user.userId, query);
  }
  @Post('accounts')
  async createAccount(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceAccountDto,
  ) {
    return this.wallet.create(spaceId, user.userId, dto);
  }
  @Get('accounts/:id')
  async account(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    return this.wallet.get(spaceId, user.userId, id);
  }
  @Patch('accounts/:id')
  async renameAccount(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: RenameSpaceAccountDto,
  ) {
    return this.wallet.rename(spaceId, user.userId, id, dto.name);
  }
  @Post('accounts/:id/archive')
  @HttpCode(204)
  async archiveAccount(
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    _body: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    await this.wallet.archive(spaceId, user.userId, id);
  }
  @Delete('accounts/:id')
  @HttpCode(204)
  async deleteAccount(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    await this.wallet.remove(spaceId, user.userId, id);
  }
  @Post('transfers')
  createTransfer(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceTransferDto,
  ) {
    return this.transfers.create(spaceId, user.userId, dto);
  }
  @Get('transfers')
  listTransfers(
    @Query()
    query: SpaceTransfersQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.transfers.list(spaceId, user.userId, query);
  }
  @Get('transfers/:id')
  getTransfer(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.transfers.get(spaceId, user.userId, id);
  }
  @Patch('transfers/:id')
  updateTransfer(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: UpdateSpaceTransferDto,
  ) {
    return this.transfers.change(spaceId, user.userId, id, dto);
  }
  @Delete('transfers/:id')
  @HttpCode(204)
  async deleteTransfer(
    @Query()
    _query: EmptySpaceQueryDto,
    @Body()
    _body: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    await this.transfers.change(spaceId, user.userId, id);
  }
  @Get('expenses/revenue')
  async revenue(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceExpensesQueryDto,
  ) {
    return this.transactions.revenue(spaceId, user.userId, query);
  }
  @Get('transactions')
  async transactionsList(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceTransactionsQueryDto,
  ) {
    return this.transactions.list(spaceId, user.userId, query);
  }
  @Get('expenses')
  async listExpense(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceExpensesQueryDto,
  ) {
    return this.transactions.list(spaceId, user.userId, query, 'expense');
  }
  @Post('expenses')
  async createExpense(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceExpenseDto,
  ) {
    return this.transactions.create(spaceId, user.userId, 'expense', dto);
  }
  @Get('expenses/:id')
  async getExpense(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    return this.transactions.get(spaceId, user.userId, id, 'expense');
  }
  @Patch('expenses/:id')
  async updateExpense(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: UpdateSpaceExpenseDto,
  ) {
    return this.transactions.change(spaceId, user.userId, id, 'expense', dto);
  }
  @Delete('expenses/:id')
  @HttpCode(204)
  async deleteExpense(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    await this.transactions.change(spaceId, user.userId, id, 'expense');
  }
  @Get('incomes')
  async listIncome(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceTransactionsQueryDto,
  ) {
    return this.transactions.list(spaceId, user.userId, query, 'income');
  }
  @Post('incomes')
  async createIncome(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceIncomeDto,
  ) {
    return this.transactions.create(spaceId, user.userId, 'income', dto);
  }
  @Get('incomes/:id')
  async getIncome(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    return this.transactions.get(spaceId, user.userId, id, 'income');
  }
  @Patch('incomes/:id')
  async updateIncome(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: UpdateSpaceIncomeDto,
  ) {
    return this.transactions.change(spaceId, user.userId, id, 'income', dto);
  }
  @Delete('incomes/:id')
  @HttpCode(204)
  async deleteIncome(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    await this.transactions.change(spaceId, user.userId, id, 'income');
  }
  @Get('expense-categories')
  async listCategories(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.settings.listCategories(spaceId, user.userId);
  }
  @Post('expense-categories')
  async createCategory(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceCategoryDto,
  ) {
    return this.settings.saveCategory(spaceId, user.userId, dto);
  }
  @Get('expense-categories/:id')
  async getCategory(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    return this.settings.getCategory(spaceId, user.userId, id);
  }
  @Patch('expense-categories/:id')
  async updateCategory(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: UpdateSpaceCategoryDto,
  ) {
    return this.settings.saveCategory(spaceId, user.userId, dto, id);
  }
  @Delete('expense-categories/:id')
  @HttpCode(204)
  async deleteCategory(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    await this.settings.removeCategory(spaceId, user.userId, id);
  }
  @Get('expense-limits')
  async listLimits(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceLimitsQueryDto,
  ) {
    return this.settings.listLimits(spaceId, user.userId, query);
  }
  @Post('expense-limits')
  async createLimit(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Body()
    dto: CreateSpaceLimitDto,
  ) {
    return this.settings.saveLimit(spaceId, user.userId, dto);
  }
  @Get('expense-limits/:id')
  async getLimit(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    return this.settings.getLimit(spaceId, user.userId, id);
  }
  @Patch('expense-limits/:id')
  async updateLimit(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
    @Body()
    dto: UpdateSpaceLimitDto,
  ) {
    return this.settings.saveLimit(spaceId, user.userId, dto, id);
  }
  @Delete('expense-limits/:id')
  @HttpCode(204)
  async deleteLimit(
    @Query()
    _query: EmptySpaceQueryDto,
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe)
    id: string,
  ) {
    await this.settings.removeLimit(spaceId, user.userId, id);
  }
  @Get('reports/months')
  async months(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceReportsQueryDto,
  ) {
    return this.reports.report(spaceId, user.userId, query, false);
  }
  @Get('reports/years')
  async years(
    @Param('spaceId', ParseObjectIdPipe)
    spaceId: string,
    @CurrentUser()
    user: AuthenticatedUser,
    @Query()
    query: SpaceReportsQueryDto,
  ) {
    return this.reports.report(spaceId, user.userId, query, true);
  }
}
