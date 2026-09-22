import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { TwoFactorService } from './two-factor.service';

describe('TwoFactorService', () => {
  const userId = '507f1f77bcf86cd799439011';
  const now = new Date('2026-01-01T00:00:00Z');
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn(async () => session) };
  const model = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    updateOne: jest.fn(),
  };
  const usersService = {
    findByIdWithPassword: jest.fn(),
    findAuthenticationState: jest.fn(),
    incrementAuthVersion: jest.fn(),
    findProfile: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn() };
  const totpService = {
    generateSecret: jest.fn(),
    generateUri: jest.fn(),
    verify: jest.fn(),
  };
  const encryptionService = { encrypt: jest.fn(), decrypt: jest.fn() };
  const recoveryCodeService = {
    generate: jest.fn(),
    matches: jest.fn(),
  };
  const challengeService = {
    issue: jest.fn(),
    resolve: jest.fn(),
    recordFailure: jest.fn(),
    consume: jest.fn(),
  };
  const throttleService = {
    assertSecondFactorAllowed: jest.fn(),
    recordSecondFactorFailure: jest.fn(),
    resetSecondFactorFailures: jest.fn(),
  };
  const auditService = { record: jest.fn() };

  const service = new TwoFactorService(
    connection as never,
    model as never,
    usersService as never,
    jwtService as never,
    totpService as never,
    encryptionService as never,
    recoveryCodeService as never,
    challengeService as never,
    throttleService as never,
    auditService as never,
    new ConfigService({
      twoFactor: { enrollmentEnabled: true, setupTtlSeconds: 600 },
    }),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    session.withTransaction.mockImplementation(async (work) => work());
    usersService.findAuthenticationState.mockResolvedValue({
      userId,
      email: 'ada@example.com',
      authVersion: 0,
    });
    usersService.findProfile.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      firstName: 'Ada',
    });
    jwtService.signAsync.mockResolvedValue('new.jwt');
    throttleService.assertSecondFactorAllowed.mockResolvedValue(undefined);
  });

  it.each([
    [null, { status: 'disabled', recoveryCodesRemaining: 0 }],
    [
      { status: 'pending', pendingExpiresAt: new Date('2025-12-31T23:59:00Z') },
      { status: 'disabled', recoveryCodesRemaining: 0 },
    ],
    [
      { status: 'enabled', recoveryCodes: [{}, {}] },
      { status: 'enabled', recoveryCodesRemaining: 2 },
    ],
  ])('projects a safe status for %p', async (credential, expected) => {
    model.findOne.mockReturnValue(query(credential));

    await expect(service.getStatus(userId, now)).resolves.toEqual(expected);
  });

  it('starts pending setup after password reauthentication without a QR image', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(query(null));
    model.findOneAndUpdate.mockResolvedValue({});
    totpService.generateSecret.mockReturnValue('BASE32SECRET');
    totpService.generateUri.mockReturnValue('otpauth://totp/Babki');
    encryptionService.encrypt.mockReturnValue({ keyId: 'v1' });

    const result = await service.startSetup(userId, 'password123', now);

    expect(result).toEqual({
      secret: 'BASE32SECRET',
      otpauthUri: 'otpauth://totp/Babki',
      expiresAt: new Date('2026-01-01T00:10:00Z'),
    });
    expect(result).not.toHaveProperty('qrCode');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { userId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'pending',
          secretEnvelope: { keyId: 'v1' },
          pendingExpiresAt: new Date('2026-01-01T00:10:00Z'),
        }),
      }),
      { upsert: true, returnDocument: 'after' },
    );
  });

  it('accepts password-only deletion step-up when 2FA is disabled', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({ passwordHash });
    model.findOne.mockReturnValue(query(null));

    await expect(
      service.assertDeletionStepUp(userId, 'password123', undefined, now),
    ).resolves.toBeUndefined();
  });

  it('requires and consumes a fresh TOTP step for deletion when 2FA is enabled', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({ passwordHash });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        lastAcceptedTimeStep: 120,
      }),
    );
    encryptionService.decrypt.mockReturnValue({ plaintext: 'SECRET' });
    totpService.verify.mockResolvedValue(121);
    model.updateOne.mockResolvedValue({ matchedCount: 1 });

    await expect(
      service.assertDeletionStepUp(userId, 'password123', '123456', now),
    ).resolves.toBeUndefined();
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'credential-id' }),
      { $set: { lastAcceptedTimeStep: 121 } },
    );
  });

  it('rejects deletion step-up without a second factor when 2FA is enabled', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({ passwordHash });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
      }),
    );

    await expect(
      service.assertDeletionStepUp(userId, 'password123', undefined, now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns conflict for an enabled credential while enrollment is gated off', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(query({ status: 'enabled' }));

    await expect(
      enrollmentDisabledService().startSetup(userId, 'password123', now),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usersService.findByIdWithPassword).toHaveBeenCalledWith(userId);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reauthenticates before gating creation of a new pending setup', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(query(null));

    await expect(
      enrollmentDisabledService().startSetup(userId, 'password123', now),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usersService.findByIdWithPassword).toHaveBeenCalledWith(userId);
    expect(model.findOne).toHaveBeenCalledWith({ userId });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not reveal rollout state before password reauthentication', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });

    await expect(
      enrollmentDisabledService().startSetup(userId, 'wrong-password', now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('does not create pending setup after incorrect password reauthentication', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });

    await expect(
      service.startSetup(userId, 'wrong-password', now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(model.findOne).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects setup when a factor is already enabled', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(query({ status: 'enabled' }));

    await expect(
      service.startSetup(userId, 'password123', now),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirms setup atomically and returns recovery codes once', async () => {
    const credential = {
      _id: 'credential-id',
      userId,
      status: 'pending',
      secretEnvelope: { keyId: 'v1' },
      pendingExpiresAt: new Date('2026-01-01T00:05:00Z'),
    };
    model.findOne.mockReturnValue(query(credential));
    model.findOneAndUpdate.mockResolvedValue({ _id: credential._id });
    encryptionService.decrypt.mockReturnValue({
      plaintext: 'BASE32SECRET',
      needsRotation: false,
    });
    totpService.verify.mockResolvedValue(123);
    recoveryCodeService.generate.mockReturnValue({
      codes: Array.from({ length: 10 }, (_, index) => `CODE-${index}`),
      digests: Array.from({ length: 10 }, (_, index) => ({
        keyId: 'v1',
        digest: `digest-${index}`,
      })),
    });
    usersService.incrementAuthVersion.mockResolvedValue({
      userId,
      email: 'ada@example.com',
      authVersion: 1,
    });

    const result = await service.confirmSetup(userId, '123456', {}, now);

    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.accessToken).toBe('new.jwt');
    expect(session.withTransaction).toHaveBeenCalled();
    expect(usersService.incrementAuthVersion).toHaveBeenCalledWith(
      userId,
      session,
    );
    expect(auditService.record).toHaveBeenCalledWith(
      userId,
      'two_factor.enrolled',
      {},
      session,
    );
  });

  it('checks the persisted second-factor block before confirming setup', async () => {
    throttleService.assertSecondFactorAllowed.mockRejectedValue(
      new Error('blocked'),
    );

    await expect(
      service.confirmSetup(userId, '123456', {}, now),
    ).rejects.toThrow('blocked');
    expect(throttleService.assertSecondFactorAllowed).toHaveBeenCalledWith(
      userId,
      now,
    );
    expect(model.findOne).not.toHaveBeenCalled();
    expect(totpService.verify).not.toHaveBeenCalled();
  });

  it('records an invalid pending-setup TOTP after transaction rollback', async () => {
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'pending',
        secretEnvelope: { keyId: 'v1' },
        pendingExpiresAt: new Date('2026-01-01T00:05:00Z'),
      }),
    );
    encryptionService.decrypt.mockReturnValue({
      plaintext: 'BASE32SECRET',
      needsRotation: false,
    });
    totpService.verify.mockResolvedValue(null);
    throttleService.recordSecondFactorFailure.mockResolvedValue({
      failedAttempts: 1,
    });

    await expect(
      service.confirmSetup(userId, '000000', { ip: '203.0.113.10' }, now),
    ).rejects.toEqual(new UnauthorizedException('Invalid two-factor setup.'));
    expect(throttleService.recordSecondFactorFailure).toHaveBeenCalledWith(
      userId,
      now,
      session,
    );
    expect(usersService.incrementAuthVersion).not.toHaveBeenCalled();
  });

  it('leaves expired or invalid pending setup unchanged', async () => {
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        status: 'pending',
        secretEnvelope: { keyId: 'v1' },
        pendingExpiresAt: new Date('2025-12-31T23:59:59Z'),
      }),
    );

    await expect(
      service.confirmSetup(userId, '123456', {}, now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(throttleService.recordSecondFactorFailure).not.toHaveBeenCalled();
    expect(usersService.incrementAuthVersion).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('never signs a replacement JWT when confirmation rolls back', async () => {
    session.withTransaction.mockRejectedValueOnce(new Error('write conflict'));

    await expect(
      service.confirmSetup(userId, '123456', {}, now),
    ).rejects.toThrow('write conflict');
    expect(session.endSession).toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('completes one challenge with TOTP and advances the accepted time step', async () => {
    challengeService.resolve.mockResolvedValue({ userId, authVersion: 0 });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        lastAcceptedTimeStep: 120,
        recoveryCodes: [],
      }),
    );
    encryptionService.decrypt.mockReturnValue({
      plaintext: 'BASE32SECRET',
      needsRotation: false,
    });
    totpService.verify.mockResolvedValue(121);
    model.findOneAndUpdate.mockResolvedValue({ _id: 'credential-id' });
    challengeService.consume.mockResolvedValue({});

    const result = await service.completeLogin(
      'challenge',
      'totp',
      '123456',
      {},
      now,
    );

    expect(result.accessToken).toBe('new.jwt');
    expect(model.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: 'credential-id',
      $or: expect.arrayContaining([{ lastAcceptedTimeStep: { $lt: 121 } }]),
    });
    expect(challengeService.consume).toHaveBeenCalled();
    expect(throttleService.resetSecondFactorFailures).toHaveBeenCalledWith(
      userId,
      session,
    );
  });

  it('rejects a challenge whose authentication version became stale', async () => {
    challengeService.resolve.mockResolvedValue({ userId, authVersion: 0 });
    usersService.findAuthenticationState.mockResolvedValue({
      userId,
      email: 'ada@example.com',
      authVersion: 1,
    });

    await expect(
      service.completeLogin('challenge', 'totp', '123456', {}, now),
    ).rejects.toEqual(
      new UnauthorizedException('Invalid authentication challenge.'),
    );
    expect(model.findOne).not.toHaveBeenCalled();
    expect(challengeService.consume).not.toHaveBeenCalled();
  });

  it('uses and removes exactly one recovery code during challenge completion', async () => {
    challengeService.resolve.mockResolvedValue({ userId, authVersion: 0 });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        recoveryCodes: [
          { keyId: 'v1', digest: 'first' },
          { keyId: 'v1', digest: 'second' },
        ],
      }),
    );
    recoveryCodeService.matches.mockImplementation(
      (_code: string, digest: { digest: string }) => digest.digest === 'second',
    );
    model.findOneAndUpdate.mockResolvedValue({ _id: 'credential-id' });
    challengeService.consume.mockResolvedValue({});

    await service.completeLogin('challenge', 'recovery', 'RECOVERY', {}, now);

    expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $pull: { recoveryCodes: { keyId: 'v1', digest: 'second' } },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      userId,
      'recovery_code.used',
      {},
      session,
    );
  });

  it('records indistinguishable failures without consuming a challenge', async () => {
    challengeService.resolve.mockResolvedValue({ userId, authVersion: 0 });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        recoveryCodes: [],
      }),
    );
    encryptionService.decrypt.mockReturnValue({ plaintext: 'SECRET' });
    totpService.verify.mockResolvedValue(null);

    await expect(
      service.completeLogin('challenge', 'totp', '000000', {}, now),
    ).rejects.toEqual(new UnauthorizedException('Invalid two-factor code.'));
    expect(challengeService.recordFailure).toHaveBeenCalledWith(
      'challenge',
      now,
    );
    expect(throttleService.recordSecondFactorFailure).toHaveBeenCalledWith(
      userId,
      now,
      session,
    );
    expect(challengeService.consume).not.toHaveBeenCalled();
  });

  it('normalizes MongoDB transaction contention as a replay failure', async () => {
    challengeService.resolve.mockResolvedValue({ userId, authVersion: 0 });
    session.withTransaction.mockRejectedValueOnce({
      code: 112,
      errorLabels: ['TransientTransactionError'],
    });

    await expect(
      service.completeLogin('challenge', 'totp', '123456', {}, now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(challengeService.recordFailure).toHaveBeenCalledWith(
      'challenge',
      now,
    );
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('audits the failure that starts a persisted second-factor block', async () => {
    challengeService.resolve.mockResolvedValue({ userId, authVersion: 0 });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        recoveryCodes: [],
      }),
    );
    encryptionService.decrypt.mockReturnValue({ plaintext: 'SECRET' });
    totpService.verify.mockResolvedValue(null);
    throttleService.recordSecondFactorFailure.mockResolvedValue({
      blockedUntil: new Date('2026-01-01T00:15:00Z'),
    });

    await expect(
      service.completeLogin(
        'challenge',
        'totp',
        '000000',
        { ip: '203.0.113.10' },
        now,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(throttleService.recordSecondFactorFailure).toHaveBeenCalledWith(
      userId,
      now,
      session,
    );
    expect(auditService.record).toHaveBeenCalledWith(
      userId,
      'two_factor.blocked',
      { ip: '203.0.113.10' },
      session,
    );
  });

  it('disables TOTP atomically with password and a current TOTP', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
      }),
    );
    encryptionService.decrypt.mockReturnValue({ plaintext: 'SECRET' });
    totpService.verify.mockResolvedValue(121);
    model.deleteOne.mockResolvedValue({ deletedCount: 1 });
    usersService.incrementAuthVersion.mockResolvedValue({
      userId,
      email: 'ada@example.com',
      authVersion: 1,
    });

    const result = await service.disable(
      userId,
      'password123',
      'totp',
      '123456',
      {},
      now,
    );

    expect(result.accessToken).toBe('new.jwt');
    expect(model.deleteOne).toHaveBeenCalledWith(
      { _id: 'credential-id', status: 'enabled' },
      { session },
    );
    expect(auditService.record).toHaveBeenCalledWith(
      userId,
      'two_factor.disabled',
      {},
      session,
    );
  });

  it('keeps the enabled credential when disable step-up is incomplete', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });

    await expect(
      service.disable(userId, 'wrong-password', 'totp', '123456', {}, now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(model.deleteOne).not.toHaveBeenCalled();
    expect(usersService.incrementAuthVersion).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('disables TOTP with password and one unused recovery code', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        recoveryCodes: [{ keyId: 'v1', digest: 'digest' }],
      }),
    );
    recoveryCodeService.matches.mockReturnValue(true);
    model.deleteOne.mockResolvedValue({ deletedCount: 1 });
    usersService.incrementAuthVersion.mockResolvedValue({
      userId,
      email: 'ada@example.com',
      authVersion: 1,
    });

    await expect(
      service.disable(userId, 'password123', 'recovery', 'RECOVERY', {}, now),
    ).resolves.toMatchObject({ accessToken: 'new.jwt' });
  });

  it('regenerates and replaces recovery codes with password plus TOTP', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        lastAcceptedTimeStep: 120,
      }),
    );
    encryptionService.decrypt.mockReturnValue({ plaintext: 'SECRET' });
    totpService.verify.mockResolvedValue(121);
    recoveryCodeService.generate.mockReturnValue({
      codes: Array.from({ length: 10 }, (_, index) => `NEW-${index}`),
      digests: Array.from({ length: 10 }, (_, index) => ({
        keyId: 'v1',
        digest: `new-digest-${index}`,
      })),
    });
    model.findOneAndUpdate.mockResolvedValue({ _id: 'credential-id' });
    usersService.incrementAuthVersion.mockResolvedValue({
      userId,
      email: 'ada@example.com',
      authVersion: 1,
    });

    const result = await service.regenerateRecoveryCodes(
      userId,
      'password123',
      '123456',
      {},
      now,
    );

    expect(result.recoveryCodes).toHaveLength(10);
    expect(model.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      lastAcceptedTimeStep: 121,
      recoveryCodes: expect.any(Array),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      userId,
      'recovery_codes.regenerated',
      {},
      session,
    );
  });

  it('does not expose recovery plaintext or sign when regeneration loses a replay race', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByIdWithPassword.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      passwordHash,
    });
    model.findOne.mockReturnValue(
      query({
        _id: 'credential-id',
        userId,
        status: 'enabled',
        secretEnvelope: { keyId: 'v1' },
        lastAcceptedTimeStep: 120,
      }),
    );
    encryptionService.decrypt.mockReturnValue({ plaintext: 'SECRET' });
    totpService.verify.mockResolvedValue(121);
    recoveryCodeService.generate.mockReturnValue({
      codes: ['PLAINTEXT'],
      digests: [{ keyId: 'v1', digest: 'digest' }],
    });
    model.findOneAndUpdate.mockResolvedValue(null);

    await expect(
      service.regenerateRecoveryCodes(userId, 'password123', '123456', {}, now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.incrementAuthVersion).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  function query(value: unknown) {
    const selected = {
      session: jest.fn(),
      lean: () => ({ exec: () => Promise.resolve(value) }),
    };
    selected.session.mockReturnValue(selected);
    return { select: () => selected };
  }

  function enrollmentDisabledService() {
    return new TwoFactorService(
      connection as never,
      model as never,
      usersService as never,
      jwtService as never,
      totpService as never,
      encryptionService as never,
      recoveryCodeService as never,
      challengeService as never,
      throttleService as never,
      auditService as never,
      new ConfigService({
        twoFactor: { enrollmentEnabled: false, setupTtlSeconds: 600 },
      }),
    );
  }
});
