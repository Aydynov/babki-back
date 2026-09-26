import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class UpdateAccountSnapshotDto {
  @Type(() => Number)
  @IsNumber()
  amount: number;
}
