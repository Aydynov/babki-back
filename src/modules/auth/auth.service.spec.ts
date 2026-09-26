import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  AuthRateLimitException,
  AuthThrottleService,
} from './services/auth-throttle.service';
import { TwoFactorService } from './services/two-factor.service';

jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});

describe('AuthService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const profile = {
    _id: userId,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    defaultCurrency: 'USD',
    defaultAccountId: null,
  };
  const usersService = {
    createWithPassword: jest.fn(),
    findAuthenticationState: jest.fn(),
    findByEmailWithPassword: jest.fn(),
    findProfile: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const authThrottleService = {
    assertPasswordAllowed: jest.fn(),
    recordPasswordFailure: jest.fn(),
    resetPasswordFailures: jest.fn(),
  };
  const twoFactorService = {
    getStatus: jest.fn(),
    issueLoginChallenge: jest.fn(),
  };

  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: AuthThrottleService, useValue: authThrottleService },
        { provide: TwoFactorService, useValue: twoFactorService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    usersService.findProfile.mockResolvedValue(profile);
    usersService.findAuthenticationState.mockResolvedValue({
      userId,
      email: profile.email,
      authVersion: 0,
    });
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');
    authThrottleService.assertPasswordAllowed.mockResolvedValue(undefined);
    authThrottleService.recordPasswordFailure.mockResolvedValue(undefined);
    authThrottleService.resetPasswordFailures.mockResolvedValue(undefined);
    twoFactorService.getStatus.mockResolvedValue({
      status: 'disabled',
      recoveryCodesRemaining: 0,
    });
  });

  it('registers users with a hashed password and returns an access token', async () => {
    let capturedPasswordHash = '';
    usersService.createWithPassword.mockImplementation(
      (_createUserDto: unknown, passwordHash: string) => {
        capturedPasswordHash = passwordHash;

        return Promise.resolve(profile);
      },
    );

    const result = await service.register({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada@Example.com',
      password: 'password123',
      currency: 'usd',
    });

    expect(usersService.createWithPassword).toHaveBeenCalledWith(
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'Ada@Example.com',
        description: undefined,
        defaultCurrency: 'USD',
      },
      expect.any(String),
    );
    expect(capturedPasswordHash).not.toBe('password123');
    await expect(
      bcrypt.compare('password123', capturedPasswordHash),
    ).resolves.toBe(true);
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: userId,
      email: profile.email,
      authVersion: 0,
    });
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      user: profile,
    });
  });

  it('bubbles duplicate email conflicts from user creation', async () => {
    usersService.createWithPassword.mockRejectedValue(
      new ConflictException('A user with this email already exists.'),
    );

    await expect(
      service.register({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: 'password123',
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with a valid password', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByEmailWithPassword.mockResolvedValue({
      ...profile,
      passwordHash,
    });

    const result = await service.login(
      {
        email: 'ada@example.com',
        password: 'password123',
      },
      '203.0.113.10',
    );

    expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith(
      'ada@example.com',
    );
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      user: profile,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: userId,
      email: profile.email,
      authVersion: 0,
    });
    expect(authThrottleService.resetPasswordFailures).toHaveBeenCalledWith(
      'ada@example.com',
      '203.0.113.10',
    );
  });

  it('rejects login without revealing whether the email exists', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(null);

    await expect(
      service.login(
        {
          email: 'missing@example.com',
          password: 'password123',
        },
        '203.0.113.10',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(bcrypt.compare).toHaveBeenCalledWith(
      'password123',
      expect.stringMatching(/^\$2[aby]\$/),
    );
    expect(authThrottleService.recordPasswordFailure).toHaveBeenCalledWith(
      'missing@example.com',
      '203.0.113.10',
    );
  });

  it('rejects login when the password is invalid', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByEmailWithPassword.mockResolvedValue({
      ...profile,
      passwordHash,
    });

    await expect(
      service.login(
        {
          email: 'ada@example.com',
          password: 'wrong-password',
        },
        '203.0.113.10',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authThrottleService.recordPasswordFailure).toHaveBeenCalledWith(
      'ada@example.com',
      '203.0.113.10',
    );
  });

  it('checks the persisted password block before reading credentials', async () => {
    authThrottleService.assertPasswordAllowed.mockRejectedValue(
      new AuthRateLimitException(300),
    );

    await expect(
      service.login(
        { email: 'ada@example.com', password: 'password123' },
        '203.0.113.10',
      ),
    ).rejects.toMatchObject({ retryAfterSeconds: 300 });
    expect(usersService.findByEmailWithPassword).not.toHaveBeenCalled();
  });

  it('returns only a challenge after password login when TOTP is enabled', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByEmailWithPassword.mockResolvedValue({
      ...profile,
      passwordHash,
    });
    twoFactorService.getStatus.mockResolvedValue({
      status: 'enabled',
      recoveryCodesRemaining: 10,
    });
    twoFactorService.issueLoginChallenge.mockResolvedValue({
      requiresTwoFactor: true,
      challengeToken: 'challenge',
      expiresAt: new Date('2026-01-01T00:05:00Z'),
    });

    await expect(
      service.login(
        { email: 'ada@example.com', password: 'password123' },
        '203.0.113.10',
      ),
    ).resolves.toEqual({
      requiresTwoFactor: true,
      challengeToken: 'challenge',
      expiresAt: new Date('2026-01-01T00:05:00Z'),
    });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(usersService.findProfile).not.toHaveBeenCalled();
  });
});
