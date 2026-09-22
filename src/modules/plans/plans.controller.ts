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
import { ClosePlanDto } from './dto/close-plan.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() createPlanDto: CreatePlanDto,
  ) {
    return this.plansService.create(currentUser.userId, createPlanDto);
  }

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListPlansQueryDto,
  ) {
    return this.plansService.findAll(currentUser.userId, query);
  }

  @Get(':planId')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('planId', ParseObjectIdPipe) planId: string,
  ) {
    return this.plansService.findOne(currentUser.userId, planId);
  }

  @Patch(':planId')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('planId', ParseObjectIdPipe) planId: string,
    @Body() updatePlanDto: UpdatePlanDto,
  ) {
    return this.plansService.update(currentUser.userId, planId, updatePlanDto);
  }

  @Delete(':planId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('planId', ParseObjectIdPipe) planId: string,
  ) {
    return this.plansService.remove(currentUser.userId, planId);
  }

  @Post(':planId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('planId', ParseObjectIdPipe) planId: string,
  ) {
    return this.plansService.archive(currentUser.userId, planId);
  }

  @Post(':planId/close')
  close(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('planId', ParseObjectIdPipe) planId: string,
    @Body() closePlanDto: ClosePlanDto,
  ) {
    return this.plansService.close(currentUser.userId, planId, closePlanDto);
  }
}
