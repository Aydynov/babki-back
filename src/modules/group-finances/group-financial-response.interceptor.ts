import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { omitResponseFields } from '../../common/utils/response-fields.util';

const internalFields = new Set(['__v', 'mutationVersion', 'lockVersion']);

@Injectable()
export class GroupFinancialResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(map((value: unknown) => omitResponseFields(value, internalFields)));
  }
}
