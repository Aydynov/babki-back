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
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { UpdateAccountDto } from '../../accounts/dto/update-account.dto';
import {
  accountTypes,
  type AccountType,
} from '../../accounts/schemas/accounts.schema';
import { ExpenseItemFieldsDto } from '../../transactions/expenses/dto/expense-item.dto';
const optional = (_: unknown, value: unknown) => value !== undefined;
export class SpaceAccountsQueryDto {
  @ValidateIf(optional)
  @IsIn(accountTypes)
  type?: AccountType;
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
}
export class RenameSpaceAccountDto extends UpdateAccountDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  declare name: string;
}
export class CreateSpaceAccountDto {
  @ValidateIf(optional)
  @IsIn(accountTypes)
  type?: AccountType;
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
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  openedAt?: string;
}
export class SpaceExpenseItemDto extends ExpenseItemFieldsDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;
}
export class CreateSpaceIncomeDto {
  @IsMongoId()
  accountId: string;
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;
  @IsDateString({ strict: true })
  transactionDate: string;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class CreateSpaceExpenseDto extends CreateSpaceIncomeDto {
  @IsMongoId()
  categoryId: string;
  @ValidateIf(optional)
  @IsMongoId()
  participantId?: string;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(255)
  merchant?: string;
  @ValidateIf(optional)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpaceExpenseItemDto)
  items?: SpaceExpenseItemDto[];
}
export class UpdateSpaceIncomeDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount?: number;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class UpdateSpaceExpenseDto extends UpdateSpaceIncomeDto {
  @ValidateIf(optional)
  @IsMongoId()
  categoryId?: string;
  @ValidateIf(optional)
  @IsMongoId()
  participantId?: string;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(255)
  merchant?: string;
  @ValidateIf(optional)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpaceExpenseItemDto)
  items?: SpaceExpenseItemDto[];
}
export class SpaceTransactionsQueryDto extends PaginationQueryDto {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
  @ValidateIf(optional)
  @IsMongoId()
  accountId?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  fromDate?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  toDate?: string;
  @ValidateIf(optional)
  @IsIn(['income', 'expense', 'transfer'])
  transactionType?: 'income' | 'expense' | 'transfer';
}
export class SpaceExpensesQueryDto extends SpaceTransactionsQueryDto {
  @ValidateIf(optional)
  @IsMongoId()
  categoryId?: string;
  @ValidateIf(optional)
  @IsMongoId()
  participantId?: string;
}
export class CreateSpaceCategoryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(500)
  description?: string;
  @ValidateIf(optional)
  @IsHexColor()
  color?: string;
}
export class UpdateSpaceCategoryDto {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(500)
  description?: string;
  @ValidateIf(optional)
  @IsHexColor()
  color?: string;
  @ValidateIf(optional)
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  isArchived?: boolean;
}
export class CreateSpaceLimitDto {
  @IsMongoId()
  categoryId: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total: number;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  startDate?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  endDate?: string;
}
export class UpdateSpaceLimitDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total?: number;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  startDate?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  endDate?: string;
}
export class SpaceLimitsQueryDto {
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
  @ValidateIf(optional)
  @IsMongoId()
  categoryId?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  periodDate?: string;
}
export class SpaceReportsQueryDto {
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  fromDate?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  toDate?: string;
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsMongoId({ each: true })
  categories?: string[];
}
export class EmptySpaceQueryDto {}
