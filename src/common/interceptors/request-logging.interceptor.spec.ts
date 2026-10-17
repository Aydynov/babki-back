import { Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

describe('RequestLoggingInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['preview', 'accept'])(
    'omits invitation %s query secrets from successful request logs',
    async (action) => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const request = {
        method: 'POST',
        url: `/custom/v2/GROUP-INVITATIONS/${action}/?token=query-secret&digest=query-digest`,
        body: { token: 'body-secret', digest: 'body-digest' },
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      };

      await lastValueFrom(
        new RequestLoggingInterceptor().intercept(context as never, {
          handle: () => of({}),
        }),
      );

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`^POST /custom/v2/GROUP-INVITATIONS/${action}/ \\d+ms$`),
        ),
      );
      const serialized = JSON.stringify(log.mock.calls);
      for (const secret of [
        'query-secret',
        'query-digest',
        'body-secret',
        'body-digest',
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(request.url).toContain('?token=query-secret');
    },
  );

  it('logs request metadata without serializing authentication bodies', (done) => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const request = {
      method: 'POST',
      url: '/api/v1/auth/login/two-factor',
      body: {
        password: 'secret-password',
        token: '123456',
        challengeToken: 'opaque-challenge',
        accessToken: 'signed-access-token',
        secretEnvelope: { ciphertext: 'encrypted-secret' },
        recoveryCodes: ['plaintext-recovery'],
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    new RequestLoggingInterceptor()
      .intercept(context as never, { handle: () => of({}) })
      .subscribe({
        complete: () => {
          const serialized = JSON.stringify(log.mock.calls);
          expect(serialized).toContain('POST');
          expect(serialized).toContain('/api/v1/auth/login/two-factor');
          for (const secret of Object.values(request.body).flatMap((value) =>
            typeof value === 'string' ? [value] : Object.values(value).flat(),
          )) {
            expect(serialized).not.toContain(String(secret));
          }
          log.mockRestore();
          done();
        },
      });
  });
});
