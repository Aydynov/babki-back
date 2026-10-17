import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  invitationRequestPath,
  isInvitationRequest,
} from '../utils/invitation-request-path';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    if (
      status === Number(HttpStatus.TOO_MANY_REQUESTS) &&
      typeof (exception as { retryAfterSeconds?: unknown })
        .retryAfterSeconds === 'number'
    ) {
      response.setHeader(
        'Retry-After',
        String((exception as { retryAfterSeconds: number }).retryAfterSeconds),
      );
    }

    const message = this.extractMessage(payload);
    response.status(status).json({
      statusCode: status,
      message:
        status === Number(HttpStatus.BAD_REQUEST) &&
        isInvitationRequest(request.url) &&
        Array.isArray(message)
          ? 'Invalid invitation request'
          : message,
      error: this.extractError(payload),
      path: invitationRequestPath(request.url),
      timestamp: new Date().toISOString(),
    });
  }

  private extractMessage(payload: string | object): string | string[] {
    if (typeof payload === 'string') {
      return payload;
    }

    if ('message' in payload) {
      return payload.message as string | string[];
    }

    return 'Unexpected error';
  }

  private extractError(payload: string | object): string {
    if (typeof payload === 'string') {
      return 'Error';
    }

    if ('error' in payload && typeof payload.error === 'string') {
      return payload.error;
    }

    return 'Error';
  }
}
