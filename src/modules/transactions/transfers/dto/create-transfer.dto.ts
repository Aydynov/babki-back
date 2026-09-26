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

export class CreateTransferDto {
  @IsMongoId() sourceAccountId: string;
  @IsMongoId() destinationAccountId: string;
  @Type(() => Number) @IsNumber() @Min(Number.EPSILON) sourceAmount: number;
  @Type(() => Number)
  @IsNumber()
  @Min(Number.EPSILON)
  destinationAmount: number;
  @IsDateString() transactionDate: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}
