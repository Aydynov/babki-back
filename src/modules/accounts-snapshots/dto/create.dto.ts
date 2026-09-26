import { Transform, Type } from 'class-transformer';
import { IsDateString, IsNumber, Min } from 'class-validator';
import { startOfMonth } from 'date-fns/startOfMonth';

export class CreateAccountSnapshotDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;

  @Transform(({ value }): Date => startOfMonth(value))
  @IsDateString()
  date: Date;
}
