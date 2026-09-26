import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateTransferDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(Number.EPSILON)
  sourceAmount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(Number.EPSILON)
  destinationAmount?: number;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}
