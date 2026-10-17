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

export class CreateGroupPlanDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @IsDateString({ strict: true }) targetDate: string;
  @Type(() => Number) @IsNumber() @IsPositive() amount: number;
  @Transform(currency) @IsIn(SUPPORTED_CURRENCY_CODES) currency: string;
  @IsMongoId() categoryId: string;
}

export class UpdateGroupPlanDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @ValidateIf(optional) @IsDateString({ strict: true }) targetDate?: string;
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount?: number;
  @ValidateIf(optional) @IsMongoId() categoryId?: string;
}

export class CloseGroupPlanDto {
  @IsMongoId() accountId: string;
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount?: number;
  @ValidateIf(optional) @IsDateString({ strict: true }) closingDate?: string;
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;
  @ValidateIf(optional) @IsMongoId() participantId?: string;
}

export class GroupPlansQueryDto extends PaginationQueryDto {
  @ValidateIf(optional) @IsIn(['active', 'closed']) status?:
    'active' | 'closed';
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
