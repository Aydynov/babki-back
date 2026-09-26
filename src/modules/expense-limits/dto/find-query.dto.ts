import { IsDateString, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';

export class FindExpenseLimitQueryDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;

  @IsDateString()
  periodDate: string;
}
