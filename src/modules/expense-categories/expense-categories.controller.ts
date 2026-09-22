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
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { ExpenseCategoriesService } from './expense-categories.service';

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(
    private readonly expenseCategoriesService: ExpenseCategoriesService,
  ) {}

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() createExpenseCategoryDto: CreateExpenseCategoryDto,
  ) {
    return this.expenseCategoriesService.create(
      currentUser.userId,
      createExpenseCategoryDto,
    );
  }

  @Get()
  findAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.expenseCategoriesService.findAll(currentUser.userId);
  }

  @Get(':categoryId')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('categoryId', ParseObjectIdPipe) categoryId: string,
  ) {
    return this.expenseCategoriesService.findOne(
      currentUser.userId,
      categoryId,
    );
  }

  @Patch(':categoryId')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('categoryId', ParseObjectIdPipe) categoryId: string,
    @Body() updateExpenseCategoryDto: UpdateExpenseCategoryDto,
  ) {
    return this.expenseCategoriesService.update(
      currentUser.userId,
      categoryId,
      updateExpenseCategoryDto,
    );
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('categoryId', ParseObjectIdPipe) categoryId: string,
  ) {
    return this.expenseCategoriesService.remove(currentUser.userId, categoryId);
  }
}
