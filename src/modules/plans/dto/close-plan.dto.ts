import { Type } from 'class-transformer';
import {
  IsDateString,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
export class ClosePlanDto {
  @IsMongoId()
  accountId: string;
  @IsOptional()
  @IsDateString()
  closingDate?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
