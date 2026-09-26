import { IsDateString, IsMongoId } from 'class-validator';

export class FindExpenseLimitRevenueQueryDto {
  currency: string;
  @IsMongoId()
  categoryId?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
