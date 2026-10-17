import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsIn,
  IsMongoId,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ExpenseItemFieldsDto } from '../../transactions/expenses/dto/expense-item.dto';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
import {
  accountTypes,
  type AccountType,
} from '../../accounts/schemas/accounts.schema';
import { UpdateAccountDto } from '../../accounts/dto/update-account.dto';
const optional = (_: unknown, value: unknown) => value !== undefined;
export class GroupAccountsQueryDto {
  @ValidateIf(optional) @IsIn(accountTypes) type?: AccountType;
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
}
export class RenameGroupAccountDto extends UpdateAccountDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  declare name: string;
}
export class CreateGroupAccountDto {
  @ValidateIf(optional) @IsIn(accountTypes) type?: AccountType;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) openedAt?: string;
}
export class GroupExpenseItemDto extends ExpenseItemFieldsDto {
  @Type(() => Number) @IsNumber() @IsPositive() price: number;
}
export class CreateGroupIncomeDto {
  @IsMongoId() accountId: string;
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
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
  @Type(() => GroupExpenseItemDto)
  items?: GroupExpenseItemDto[];
}
export class UpdateGroupIncomeDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
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
  @Type(() => GroupExpenseItemDto)
  items?: GroupExpenseItemDto[];
}
export class GroupTransactionsQueryDto extends PaginationQueryDto {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;
  @Type(() => Number) @IsNumber() @Min(0) total: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) startDate?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) endDate?: string;
}
export class UpdateGroupLimitDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total?: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) startDate?: string;
  @ValidateIf(optional) @IsDateString({ strict: true }) endDate?: string;
}
export class GroupLimitsQueryDto {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
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
