import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { AuthRateLimitException } from '../../modules/auth/services/auth-throttle.service';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  it.each(['preview', 'accept'])(
    'does not reflect secret field names in invitation %s validation errors',
    (action) => {
      const response = {
        setHeader: jest.fn(),
        status: jest.fn(),
        json: jest.fn(),
      };
      response.status.mockReturnValue(response);
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ url: `/api/v1/group-invitations/${action}` }),
        }),
      } as unknown as ArgumentsHost;
      new HttpExceptionFilter().catch(
        new HttpException(
          {
            message: ['property secret-token should not exist'],
            error: 'Bad Request',
          },
          400,
        ),
        host,
      );
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid invitation request',
          statusCode: 400,
          error: 'Bad Request',
        }),
      );
      expect(JSON.stringify(response.json.mock.calls)).not.toContain(
        'secret-token',
      );
    },
  );

  it.each([400, 401, 429, 503])(
    'omits invitation query secrets from normalized %s errors',
    (status) => {
      for (const action of ['preview', 'accept']) {
        const response = {
          setHeader: jest.fn(),
          status: jest.fn(),
          json: jest.fn(),
        };
        response.status.mockReturnValue(response);
        const request = {
          url: `/custom/v2/GROUP-INVITATIONS/${action}/?token=query-secret&digest=query-digest`,
          body: { token: 'body-secret', digest: 'body-digest' },
        };
        const host = {
          switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => request,
          }),
        } as unknown as ArgumentsHost;

        new HttpExceptionFilter().catch(
          new HttpException(
            { message: 'Request failed', error: 'Error' },
            status,
          ),
          host,
        );

        expect(response.json).toHaveBeenCalledWith({
          statusCode: status,
          message: 'Request failed',
          error: 'Error',
          path: `/custom/v2/GROUP-INVITATIONS/${action}/`,
          timestamp: expect.any(String),
        });
        const serialized = JSON.stringify(response.json.mock.calls);
        for (const secret of [
          'query-secret',
          'query-digest',
          'body-secret',
          'body-digest',
        ]) {
          expect(serialized).not.toContain(secret);
        }
        expect(request.url).toContain('?token=query-secret');
      }
    },
  );

  it('sets Retry-After for persisted authentication blocks', () => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/v1/auth/login' }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(new AuthRateLimitException(301), host);

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '301');
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        path: '/api/v1/auth/login',
      }),
    );
    expect(response.json.mock.calls[0][0]).not.toHaveProperty('retryAfter');
  });

  it('does not serialize secret-bearing internal exceptions', () => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/v1/auth/two-factor/setup/confirm' }),
      }),
    } as unknown as ArgumentsHost;
    const exception = Object.assign(new Error('database failure'), {
      passwordHash: 'hashed-password',
      authVersion: 7,
      token: '123456',
      challengeDigest: 'challenge-digest',
      recoveryDigest: 'recovery-digest',
      accessToken: 'signed-access-token',
    });

    new HttpExceptionFilter().catch(exception, host);

    const payload = response.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
    });
    const serialized = JSON.stringify(payload);
    for (const secret of Object.values(exception).filter(
      (value): value is string => typeof value === 'string',
    )) {
      expect(serialized).not.toContain(secret);
    }
  });
});
