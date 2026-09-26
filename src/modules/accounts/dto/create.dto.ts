import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
import { accountTypes, type AccountType } from '../schemas/accounts.schema';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsIn(accountTypes)
  type: AccountType;

  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;

  @Type(() => Number)
  @IsOptional()
  @Min(0)
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsDateString()
  openedAt?: string;
}
