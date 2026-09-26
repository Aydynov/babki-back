import { IsOptional, IsIn, IsDateString } from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
import { type AccountType, accountTypes } from '../schemas/accounts.schema';

export class FindAccountQueryDto {
  @IsOptional()
  @IsIn(accountTypes)
  type?: AccountType;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}
