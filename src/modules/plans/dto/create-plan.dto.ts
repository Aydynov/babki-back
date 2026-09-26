import { Type } from 'class-transformer';
import {
  IsDateString,
  IsMongoId,
  IsNumber,
  IsString,
  IsIn,
  MaxLength,
  Min,
} from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';

export class CreatePlanDto {
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsDateString()
  targetDate: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsMongoId()
  categoryId: string;
}
