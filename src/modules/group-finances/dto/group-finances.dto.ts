import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsIn,
  IsMongoId,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ExpenseItemDto } from '../../transactions/expenses/dto/expense-item.dto';
const optional = (_: unknown, value: unknown) => value !== undefined;
export class CreateGroupAccountDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) openedAt?: string;
}
export class CreateGroupIncomeDto {
  @IsMongoId() accountId: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
  @IsDateString({ strict: true }) transactionDate: string;
  @ValidateIf(optional) @IsString() @MaxLength(1000) description?: string;
}
export class CreateGroupExpenseDto extends CreateGroupIncomeDto {
  @IsMongoId() categoryId: string;
  @ValidateIf(optional) @IsMongoId() participantId?: string;
  @ValidateIf(optional) @IsString() @MaxLength(255) merchant?: string;
  @ValidateIf(optional)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items?: ExpenseItemDto[];
}
export class UpdateGroupIncomeDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
  @ValidateIf(optional) @IsString() @MaxLength(1000) description?: string;
}
export class UpdateGroupExpenseDto extends UpdateGroupIncomeDto {
  @ValidateIf(optional) @IsMongoId() categoryId?: string;
  @ValidateIf(optional) @IsMongoId() participantId?: string;
  @ValidateIf(optional) @IsString() @MaxLength(255) merchant?: string;
  @ValidateIf(optional)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items?: ExpenseItemDto[];
}
export class GroupTransactionsQueryDto extends PaginationQueryDto {
  @ValidateIf(optional) @IsMongoId() accountId?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) fromDate?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) toDate?: string;
  @ValidateIf(optional) @IsIn(['income', 'expense']) transactionType?:
    'income' | 'expense';
}
export class GroupExpensesQueryDto extends GroupTransactionsQueryDto {
  @ValidateIf(optional) @IsMongoId() categoryId?: string;
  @ValidateIf(optional) @IsMongoId() participantId?: string;
}
export class CreateGroupCategoryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
  @ValidateIf(optional) @IsString() @MaxLength(500) description?: string;
  @ValidateIf(optional) @IsHexColor() color?: string;
}
export class UpdateGroupCategoryDto {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
  @ValidateIf(optional) @IsString() @MaxLength(500) description?: string;
  @ValidateIf(optional) @IsHexColor() color?: string;
  @ValidateIf(optional)
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  isArchived?: boolean;
}
export class CreateGroupLimitDto {
  @IsMongoId() categoryId: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) total: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) startDate?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) endDate?: string;
}
export class UpdateGroupLimitDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total?: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) startDate?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) endDate?: string;
}
export class GroupLimitsQueryDto {
  @ValidateIf(optional) @IsMongoId() categoryId?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) periodDate?: string;
}
export class GroupReportsQueryDto {
  @ValidateIf(optional) @IsDateString({ strict: true }) fromDate?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) toDate?: string;
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsMongoId({ each: true })
  categories?: string[];
}

export class EmptyGroupQueryDto {}
