import { IsIn, IsOptional } from 'class-validator';
import { SUPPORTED_CURRENCY_CODES } from 'src/common/money/money';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { planStatuses } from '../schemas/plan.schema';
export class ListPlansQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCY_CODES)
  currency?: string;
  @IsOptional()
  @IsIn(planStatuses)
  status?: (typeof planStatuses)[number];
}
