import {
  IsDateString,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
} from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';

export class CreateExpenseLimitDto {
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;

  @IsMongoId()
  categoryId: string;

  @IsNumber()
  @Min(0.01)
  total: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
