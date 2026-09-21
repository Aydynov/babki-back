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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { GroupWalletService } from './group-wallet.service';
import { GroupTransactionsService } from './group-transactions.service';
import { GroupSettingsService } from './group-settings.service';
import { GroupReportsService } from './group-reports.service';
import {
  EmptyGroupQueryDto,
  CreateGroupAccountDto,
  CreateGroupExpenseDto,
  CreateGroupIncomeDto,
  UpdateGroupExpenseDto,
  UpdateGroupIncomeDto,
  GroupExpensesQueryDto,
  GroupTransactionsQueryDto,
  CreateGroupCategoryDto,
  UpdateGroupCategoryDto,
  CreateGroupLimitDto,
  UpdateGroupLimitDto,
  GroupLimitsQueryDto,
  GroupReportsQueryDto,
} from './dto/group-finances.dto';

@Controller('groups/:groupId')
export class GroupFinancesController {
  constructor(
    private readonly wallet: GroupWalletService,
    private readonly transactions: GroupTransactionsService,
    private readonly settings: GroupSettingsService,
    private readonly reports: GroupReportsService,
  ) {}

  @Get('accounts')
  async accounts(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.wallet.list(groupId, user.userId);
  }

  @Post('accounts')
  async createAccount(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupAccountDto,
  ) {
    return this.wallet.create(groupId, user.userId, dto);
  }

  @Get('accounts/:id')
  async account(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.wallet.get(groupId, user.userId, id);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  async deleteAccount(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.wallet.remove(groupId, user.userId, id);
  }

  @Get('expenses/revenue')
  async revenue(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupExpensesQueryDto,
  ) {
    return this.transactions.revenue(groupId, user.userId, query);
  }

  @Get('transactions')
  async transactionsList(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupTransactionsQueryDto,
  ) {
    return this.transactions.list(groupId, user.userId, query);
  }

  @Get('expenses')
  async listExpense(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupExpensesQueryDto,
  ) {
    return this.transactions.list(groupId, user.userId, query, 'expense');
  }

  @Post('expenses')
  async createExpense(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupExpenseDto,
  ) {
    return this.transactions.create(groupId, user.userId, 'expense', dto);
  }

  @Get('expenses/:id')
  async getExpense(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.transactions.get(groupId, user.userId, id, 'expense');
  }

  @Patch('expenses/:id')
  async updateExpense(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateGroupExpenseDto,
  ) {
    return this.transactions.change(groupId, user.userId, id, 'expense', dto);
  }

  @Delete('expenses/:id')
  @HttpCode(204)
  async deleteExpense(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.transactions.change(groupId, user.userId, id, 'expense');
  }

  @Get('incomes')
  async listIncome(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupTransactionsQueryDto,
  ) {
    return this.transactions.list(groupId, user.userId, query, 'income');
  }

  @Post('incomes')
  async createIncome(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupIncomeDto,
  ) {
    return this.transactions.create(groupId, user.userId, 'income', dto);
  }

  @Get('incomes/:id')
  async getIncome(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.transactions.get(groupId, user.userId, id, 'income');
  }

  @Patch('incomes/:id')
  async updateIncome(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateGroupIncomeDto,
  ) {
    return this.transactions.change(groupId, user.userId, id, 'income', dto);
  }

  @Delete('incomes/:id')
  @HttpCode(204)
  async deleteIncome(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.transactions.change(groupId, user.userId, id, 'income');
  }

  @Get('expense-categories')
  async listCategories(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.listCategories(groupId, user.userId);
  }

  @Post('expense-categories')
  async createCategory(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupCategoryDto,
  ) {
    return this.settings.saveCategory(groupId, user.userId, dto);
  }

  @Get('expense-categories/:id')
  async getCategory(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.settings.getCategory(groupId, user.userId, id);
  }

  @Patch('expense-categories/:id')
  async updateCategory(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateGroupCategoryDto,
  ) {
    return this.settings.saveCategory(groupId, user.userId, dto, id);
  }

  @Delete('expense-categories/:id')
  @HttpCode(204)
  async deleteCategory(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.settings.removeCategory(groupId, user.userId, id);
  }

  @Get('expense-limits')
  async listLimits(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupLimitsQueryDto,
  ) {
    return this.settings.listLimits(groupId, user.userId, query);
  }

  @Post('expense-limits')
  async createLimit(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupLimitDto,
  ) {
    return this.settings.saveLimit(groupId, user.userId, dto);
  }

  @Get('expense-limits/:id')
  async getLimit(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.settings.getLimit(groupId, user.userId, id);
  }

  @Patch('expense-limits/:id')
  async updateLimit(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateGroupLimitDto,
  ) {
    return this.settings.saveLimit(groupId, user.userId, dto, id);
  }

  @Delete('expense-limits/:id')
  @HttpCode(204)
  async deleteLimit(
    @Query() _query: EmptyGroupQueryDto,
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.settings.removeLimit(groupId, user.userId, id);
  }

  @Get('reports/months')
  async months(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupReportsQueryDto,
  ) {
    return this.reports.report(groupId, user.userId, query, false);
  }

  @Get('reports/years')
  async years(
    @Param('groupId', ParseObjectIdPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupReportsQueryDto,
  ) {
    return this.reports.report(groupId, user.userId, query, true);
  }
}
