import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { debtStatuses } from '../schemas/debt.schema';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';

export class CreateDebtDto {
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency: string;

  @IsString()
  @MaxLength(150)
  debtor: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  principalAmount: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  remainingAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsIn(debtStatuses)
  status?: (typeof debtStatuses)[number];
}
