import { Type } from 'class-transformer';
import {
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ExpenseItemFieldsDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;
}

export class ExpenseItemDto extends ExpenseItemFieldsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  price: number;
}
