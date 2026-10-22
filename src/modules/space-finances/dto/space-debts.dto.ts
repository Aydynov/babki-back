import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
const optional = (_: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const currency = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
export class CreateSpaceDebtDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  debtor: string;
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  principalAmount: number;
  @Transform(currency)
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  description?: string;
  @ValidateIf(optional)
  @IsDateString({ strict: true })
  dueDate?: string;
}
export class UpdateSpaceDebtDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  debtor?: string;
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  principalAmount?: number;
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  description?: string;
  @ValidateIf(
    (_: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsDateString({ strict: true })
  dueDate?: string | null;
}
export class RepaySpaceDebtDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;
  @IsDateString({ strict: true })
  repaymentDate: string;
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  isIncome: boolean;
  @ValidateIf(
    (dto: RepaySpaceDebtDto, value: unknown) =>
      dto.isIncome === true || value !== undefined,
  )
  @IsMongoId()
  accountId?: string;
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class SpaceDebtsQueryDto extends PaginationQueryDto {
  @ValidateIf(optional)
  @IsIn(['active', 'closed'])
  status?: 'active' | 'closed';
  @ValidateIf(optional)
  @Transform(currency)
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
  @ValidateIf(optional)
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const value = obj[key];
    return value === 'true' ? true : value === 'false' ? false : value;
  })
  @IsBoolean()
  includeArchived?: boolean;
}
