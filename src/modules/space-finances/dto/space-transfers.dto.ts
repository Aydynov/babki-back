import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SUPPORTED_CURRENCY_CODES } from '../../../common/money/money';
const optional = (_: unknown, value: unknown) => value !== undefined;
export class CreateSpaceTransferDto {
  @IsMongoId()
  sourceAccountId: string;
  @IsMongoId()
  destinationAccountId: string;
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  sourceAmount: number;
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  destinationAmount: number;
  @IsDateString({ strict: true })
  transactionDate: string;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class UpdateSpaceTransferDto {
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  sourceAmount?: number;
  @ValidateIf(optional)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  destinationAmount?: number;
  @ValidateIf(optional)
  @IsString()
  @MaxLength(1000)
  description?: string;
}
export class SpaceTransfersQueryDto extends PaginationQueryDto {
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
}
