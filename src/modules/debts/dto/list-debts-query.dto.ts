import { IsIn, IsOptional } from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { debtStatuses } from '../schemas/debt.schema';
export class ListDebtsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
  @IsOptional()
  @IsIn(debtStatuses)
  status?: (typeof debtStatuses)[number];
}
