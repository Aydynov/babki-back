import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

describe('AuthController', () => {
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
  };
  const twoFactorService = {
    completeLogin: jest.fn(),
    getStatus: jest.fn(),
    startSetup: jest.fn(),
    confirmSetup: jest.fn(),
    disable: jest.fn(),
    regenerateRecoveryCodes: jest.fn(),
    assertDeletionStepUp: jest.fn(),
  };
  const userDeletionService = { request: jest.fn() };
  const request = {
    ip: '203.0.113.10',
    get: jest.fn().mockReturnValue('test-agent'),
  } as unknown as Request;
  const currentUser = {
    userId: '507f1f77bcf86cd799439011',
    email: 'ada@example.com',
    authVersion: 2,
  };

  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      authService as never,
      twoFactorService as never,
      userDeletionService as never,
    );
  });

  it('marks only registration and both login steps public', () => {
    const publicHandlers = ['register', 'login', 'completeTwoFactorLogin'];
    const protectedHandlers = [
      'twoFactorStatus',
      'startTwoFactorSetup',
      'confirmTwoFactorSetup',
      'disableTwoFactor',
      'regenerateRecoveryCodes',
      'requestAccountDeletion',
    ];

    for (const handler of publicHandlers) {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          AuthController.prototype[handler as keyof AuthController],
        ),
      ).toBe(true);
    }
    for (const handler of protectedHandlers) {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          AuthController.prototype[handler as keyof AuthController],
        ),
      ).not.toBe(true);
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController)).not.toBe(true);
  });

  it('performs step-up before requesting account deletion', async () => {
    const dto = { password: 'password123', secondFactorCode: '012345' };

    await controller.requestAccountDeletion(currentUser, dto);

    expect(twoFactorService.assertDeletionStepUp).toHaveBeenCalledWith(
      currentUser.userId,
      dto.password,
      dto.secondFactorCode,
    );
    expect(userDeletionService.request).toHaveBeenCalledWith(
      currentUser.userId,
    );
  });

  it('uses trusted request IP for password throttling', () => {
    const dto = { email: 'ada@example.com', password: 'password123' };
    controller.login(dto, request);
    expect(authService.login).toHaveBeenCalledWith(dto, '203.0.113.10');
  });

  it('passes only sanitized request context to challenge completion', () => {
    const dto = {
      challengeToken: 'A'.repeat(43),
      method: 'totp' as const,
      code: '012345',
    };
    controller.completeTwoFactorLogin(dto, request);
    expect(twoFactorService.completeLogin).toHaveBeenCalledWith(
      dto.challengeToken,
      dto.method,
      dto.code,
      { ip: '203.0.113.10', userAgent: 'test-agent' },
    );
  });

  it('forwards authenticated management operations', () => {
    controller.twoFactorStatus(currentUser);
    controller.startTwoFactorSetup(currentUser, { password: 'password123' });
    controller.confirmTwoFactorSetup(currentUser, { token: '012345' }, request);
    controller.disableTwoFactor(
      currentUser,
      { password: 'password123', method: 'totp', code: '012345' },
      request,
    );
    controller.regenerateRecoveryCodes(
      currentUser,
      { password: 'password123', token: '012345' },
      request,
    );

    expect(twoFactorService.getStatus).toHaveBeenCalledWith(currentUser.userId);
    expect(twoFactorService.startSetup).toHaveBeenCalledWith(
      currentUser.userId,
      'password123',
    );
    expect(twoFactorService.confirmSetup).toHaveBeenCalledWith(
      currentUser.userId,
      '012345',
      { ip: '203.0.113.10', userAgent: 'test-agent' },
    );
    expect(twoFactorService.disable).toHaveBeenCalledWith(
      currentUser.userId,
      'password123',
      'totp',
      '012345',
      { ip: '203.0.113.10', userAgent: 'test-agent' },
    );
    expect(twoFactorService.regenerateRecoveryCodes).toHaveBeenCalledWith(
      currentUser.userId,
      'password123',
      '012345',
      { ip: '203.0.113.10', userAgent: 'test-agent' },
    );
  });
});
