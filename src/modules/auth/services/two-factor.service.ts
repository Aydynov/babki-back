import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { ClientSession, Connection, Model } from 'mongoose';
import {
  UserAuthenticationState,
  UsersService,
} from '../../users/users.service';
import {
  UserTwoFactor,
  UserTwoFactorDocument,
} from '../schemas/user-two-factor.schema';
import { AuthChallengeService } from './auth-challenge.service';
import { AuthThrottleService } from './auth-throttle.service';
import { RecoveryCodeService } from './recovery-code.service';
import { SecretEncryptionService } from './secret-encryption.service';
import {
  SecurityAuditService,
  SecurityRequestContext,
} from './security-audit.service';
import { TotpService } from './totp.service';

type SecondFactorMethod = 'recovery' | 'totp';

class InvalidFactorError extends Error {}
class InvalidSetupCodeError extends Error {}

@Injectable()
export class TwoFactorService {
  private readonly enrollmentEnabled: boolean;
  private readonly setupTtlSeconds: number;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(UserTwoFactor.name)
    private readonly twoFactorModel: Model<UserTwoFactorDocument>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly totpService: TotpService,
    private readonly encryptionService: SecretEncryptionService,
    private readonly recoveryCodeService: RecoveryCodeService,
    private readonly challengeService: AuthChallengeService,
    private readonly throttleService: AuthThrottleService,
    private readonly auditService: SecurityAuditService,
    configService: ConfigService,
  ) {
    this.enrollmentEnabled = configService.getOrThrow<boolean>(
      'twoFactor.enrollmentEnabled',
    );
    this.setupTtlSeconds = configService.getOrThrow<number>(
      'twoFactor.setupTtlSeconds',
    );
  }

  async getStatus(userId: string, now = new Date()) {
    const credential = await this.loadCredential(userId);
    if (
      !credential ||
      (credential.status === 'pending' &&
        (!credential.pendingExpiresAt || credential.pendingExpiresAt <= now))
    ) {
      return { status: 'disabled' as const, recoveryCodesRemaining: 0 };
    }

    return {
      status: credential.status,
      recoveryCodesRemaining:
        credential.status === 'enabled'
          ? (credential.recoveryCodes?.length ?? 0)
          : 0,
    };
  }

  async startSetup(userId: string, password: string, now = new Date()) {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid authentication credentials.');
    }

    const existing = await this.loadCredential(userId);
    if (existing?.status === 'enabled') {
      throw new ConflictException('Two-factor authentication is enabled.');
    }
    if (!this.enrollmentEnabled) {
      throw new ServiceUnavailableException(
        'Two-factor enrollment is temporarily unavailable.',
      );
    }

    const secret = this.totpService.generateSecret();
    const expiresAt = new Date(now.getTime() + this.setupTtlSeconds * 1000);
    const secretEnvelope = this.encryptionService.encrypt(userId, secret);
    const otpauthUri = this.totpService.generateUri(user.email, secret);
    await this.twoFactorModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          status: 'pending',
          secretEnvelope,
          pendingExpiresAt: expiresAt,
          failedAttempts: 0,
        },
        $unset: {
          recoveryCodes: 1,
          lastAcceptedTimeStep: 1,
          failedWindowStartedAt: 1,
          blockedUntil: 1,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    return { secret, otpauthUri, expiresAt };
  }

  async confirmSetup(
    userId: string,
    token: string,
    context: SecurityRequestContext,
    now = new Date(),
  ) {
    await this.throttleService.assertSecondFactorAllowed(userId, now);
    let result: {
      state: UserAuthenticationState;
      recoveryCodes: string[];
    };
    try {
      result = await this.withTransaction(async (session) => {
        const credential = await this.loadCredential(userId, session);
        if (
          !credential ||
          credential.status !== 'pending' ||
          !credential.pendingExpiresAt ||
          credential.pendingExpiresAt <= now
        ) {
          throw new UnauthorizedException('Invalid two-factor setup.');
        }

        const decrypted = this.encryptionService.decrypt(
          userId,
          credential.secretEnvelope,
        );
        const timeStep = await this.totpService.verify(
          decrypted.plaintext,
          token,
          Math.floor(now.getTime() / 1000),
        );
        if (timeStep === null) {
          throw new InvalidSetupCodeError();
        }

        const recovery = this.recoveryCodeService.generate();
        const secretEnvelope = decrypted.needsRotation
          ? this.encryptionService.encrypt(userId, decrypted.plaintext)
          : credential.secretEnvelope;
        const enabled = await this.twoFactorModel.findOneAndUpdate(
          {
            _id: credential._id,
            status: 'pending',
            pendingExpiresAt: { $gt: now },
            $or: [
              { lastAcceptedTimeStep: { $exists: false } },
              { lastAcceptedTimeStep: { $lt: timeStep } },
            ],
          },
          {
            $set: {
              status: 'enabled',
              secretEnvelope,
              recoveryCodes: recovery.digests,
              lastAcceptedTimeStep: timeStep,
              failedAttempts: 0,
            },
            $unset: { pendingExpiresAt: 1, blockedUntil: 1 },
          },
          { returnDocument: 'after', session },
        );
        if (!enabled) {
          throw new UnauthorizedException('Invalid two-factor setup.');
        }

        const state = await this.usersService.incrementAuthVersion(
          userId,
          session,
        );
        await this.auditService.record(
          userId,
          'two_factor.enrolled',
          context,
          session,
        );
        return { state, recoveryCodes: recovery.codes };
      });
    } catch (error) {
      if (!(error instanceof InvalidSetupCodeError)) {
        throw error;
      }
      await this.recordSecondFactorFailure(userId, context, now);
      throw new UnauthorizedException('Invalid two-factor setup.');
    }

    return {
      ...(await this.buildAuthResponse(result.state)),
      recoveryCodes: result.recoveryCodes,
    };
  }

  async issueLoginChallenge(userId: string) {
    const state = await this.usersService.findAuthenticationState(userId);
    return this.challengeService.issue(userId, state.authVersion);
  }

  async assertDeletionStepUp(
    userId: string,
    password: string,
    token?: string,
    now = new Date(),
  ) {
    await this.assertPassword(userId, password);
    const credential = await this.loadCredential(userId);
    if (!credential || credential.status !== 'enabled') return;
    if (!token) {
      throw new UnauthorizedException('Invalid authentication credentials.');
    }
    const decrypted = this.encryptionService.decrypt(
      userId,
      credential.secretEnvelope,
    );
    const timeStep = await this.totpService.verify(
      decrypted.plaintext,
      token,
      Math.floor(now.getTime() / 1000),
    );
    if (
      timeStep === null ||
      (credential.lastAcceptedTimeStep !== undefined &&
        timeStep <= credential.lastAcceptedTimeStep)
    ) {
      throw new UnauthorizedException('Invalid authentication credentials.');
    }
    const accepted = await this.twoFactorModel.updateOne(
      {
        _id: credential._id,
        status: 'enabled',
        $or: [
          { lastAcceptedTimeStep: { $exists: false } },
          { lastAcceptedTimeStep: { $lt: timeStep } },
        ],
      },
      { $set: { lastAcceptedTimeStep: timeStep } },
    );
    if (!accepted.matchedCount) {
      throw new UnauthorizedException('Invalid authentication credentials.');
    }
  }

  async completeLogin(
    challengeToken: string,
    method: SecondFactorMethod,
    code: string,
    context: SecurityRequestContext,
    now = new Date(),
  ) {
    const challenge = await this.challengeService.resolve(challengeToken, now);
    const userId = String(challenge.userId);
    const state = await this.usersService.findAuthenticationState(userId);
    if (state.authVersion !== challenge.authVersion) {
      throw new UnauthorizedException('Invalid authentication challenge.');
    }
    await this.throttleService.assertSecondFactorAllowed(userId, now);

    try {
      await this.withTransaction(async (session) => {
        const credential = await this.loadCredential(userId, session);
        if (!credential || credential.status !== 'enabled') {
          throw new InvalidFactorError();
        }

        if (method === 'totp') {
          const decrypted = this.encryptionService.decrypt(
            userId,
            credential.secretEnvelope,
          );
          const timeStep = await this.totpService.verify(
            decrypted.plaintext,
            code,
            Math.floor(now.getTime() / 1000),
          );
          if (timeStep === null) {
            throw new InvalidFactorError();
          }
          const update: Record<string, unknown> = {
            lastAcceptedTimeStep: timeStep,
          };
          if (decrypted.needsRotation) {
            update.secretEnvelope = this.encryptionService.encrypt(
              userId,
              decrypted.plaintext,
            );
          }
          const advanced = await this.twoFactorModel.findOneAndUpdate(
            {
              _id: credential._id,
              status: 'enabled',
              $or: [
                { lastAcceptedTimeStep: { $exists: false } },
                { lastAcceptedTimeStep: { $lt: timeStep } },
              ],
            },
            { $set: update },
            { returnDocument: 'after', session },
          );
          if (!advanced) {
            throw new InvalidFactorError();
          }
        } else {
          const matched = credential.recoveryCodes?.find((digest) =>
            this.recoveryCodeService.matches(code, digest),
          );
          if (!matched) {
            throw new InvalidFactorError();
          }
          const consumed = await this.twoFactorModel.findOneAndUpdate(
            {
              _id: credential._id,
              status: 'enabled',
              recoveryCodes: matched,
            },
            { $pull: { recoveryCodes: matched } },
            { returnDocument: 'after', session },
          );
          if (!consumed) {
            throw new InvalidFactorError();
          }
          await this.auditService.record(
            userId,
            'recovery_code.used',
            context,
            session,
          );
        }

        await this.challengeService.consume(
          challengeToken,
          userId,
          state.authVersion,
          session,
          now,
        );
        await this.throttleService.resetSecondFactorFailures(userId, session);
      });
    } catch (error) {
      if (
        !(error instanceof InvalidFactorError) &&
        !this.isTransactionContention(error)
      ) {
        throw error;
      }
      await Promise.all([
        this.challengeService.recordFailure(challengeToken, now),
        this.recordSecondFactorFailure(userId, context, now),
      ]);
      throw new UnauthorizedException('Invalid two-factor code.');
    }

    return this.buildAuthResponse(state);
  }

  async disable(
    userId: string,
    password: string,
    method: SecondFactorMethod,
    code: string,
    context: SecurityRequestContext,
    now = new Date(),
  ) {
    await this.assertPassword(userId, password);
    await this.throttleService.assertSecondFactorAllowed(userId, now);

    try {
      const state = await this.withTransaction(async (session) => {
        const credential = await this.loadCredential(userId, session);
        if (!credential || credential.status !== 'enabled') {
          throw new InvalidFactorError();
        }

        if (method === 'totp') {
          const decrypted = this.encryptionService.decrypt(
            userId,
            credential.secretEnvelope,
          );
          const timeStep = await this.totpService.verify(
            decrypted.plaintext,
            code,
            Math.floor(now.getTime() / 1000),
          );
          if (
            timeStep === null ||
            (credential.lastAcceptedTimeStep !== undefined &&
              timeStep <= credential.lastAcceptedTimeStep)
          ) {
            throw new InvalidFactorError();
          }
        } else if (
          !credential.recoveryCodes?.some((digest) =>
            this.recoveryCodeService.matches(code, digest),
          )
        ) {
          throw new InvalidFactorError();
        }

        const deleted = await this.twoFactorModel.deleteOne(
          { _id: credential._id, status: 'enabled' },
          { session },
        );
        if (deleted.deletedCount !== 1) {
          throw new InvalidFactorError();
        }
        const nextState = await this.usersService.incrementAuthVersion(
          userId,
          session,
        );
        await this.auditService.record(
          userId,
          'two_factor.disabled',
          context,
          session,
        );
        return nextState;
      });
      return this.buildAuthResponse(state);
    } catch (error) {
      if (
        !(error instanceof InvalidFactorError) &&
        !this.isTransactionContention(error)
      ) {
        throw error;
      }
      await this.recordSecondFactorFailure(userId, context, now);
      throw new UnauthorizedException('Invalid authentication credentials.');
    }
  }

  async regenerateRecoveryCodes(
    userId: string,
    password: string,
    token: string,
    context: SecurityRequestContext,
    now = new Date(),
  ) {
    await this.assertPassword(userId, password);
    await this.throttleService.assertSecondFactorAllowed(userId, now);

    try {
      const result = await this.withTransaction(async (session) => {
        const credential = await this.loadCredential(userId, session);
        if (!credential || credential.status !== 'enabled') {
          throw new InvalidFactorError();
        }
        const decrypted = this.encryptionService.decrypt(
          userId,
          credential.secretEnvelope,
        );
        const timeStep = await this.totpService.verify(
          decrypted.plaintext,
          token,
          Math.floor(now.getTime() / 1000),
        );
        if (timeStep === null) {
          throw new InvalidFactorError();
        }

        const recovery = this.recoveryCodeService.generate();
        const update: Record<string, unknown> = {
          recoveryCodes: recovery.digests,
          lastAcceptedTimeStep: timeStep,
        };
        if (decrypted.needsRotation) {
          update.secretEnvelope = this.encryptionService.encrypt(
            userId,
            decrypted.plaintext,
          );
        }
        const regenerated = await this.twoFactorModel.findOneAndUpdate(
          {
            _id: credential._id,
            status: 'enabled',
            $or: [
              { lastAcceptedTimeStep: { $exists: false } },
              { lastAcceptedTimeStep: { $lt: timeStep } },
            ],
          },
          { $set: update },
          { returnDocument: 'after', session },
        );
        if (!regenerated) {
          throw new InvalidFactorError();
        }
        const state = await this.usersService.incrementAuthVersion(
          userId,
          session,
        );
        await this.auditService.record(
          userId,
          'recovery_codes.regenerated',
          context,
          session,
        );
        return { state, recoveryCodes: recovery.codes };
      });
      return {
        ...(await this.buildAuthResponse(result.state)),
        recoveryCodes: result.recoveryCodes,
      };
    } catch (error) {
      if (
        !(error instanceof InvalidFactorError) &&
        !this.isTransactionContention(error)
      ) {
        throw error;
      }
      await this.recordSecondFactorFailure(userId, context, now);
      throw new UnauthorizedException('Invalid authentication credentials.');
    }
  }

  private async loadCredential(userId: string, session?: ClientSession) {
    const query = this.twoFactorModel
      .findOne({ userId })
      .select(
        '+secretEnvelope +pendingExpiresAt +recoveryCodes +lastAcceptedTimeStep +failedAttempts +blockedUntil',
      );
    if (session) {
      query.session(session);
    }
    return query.lean().exec();
  }

  private async buildAuthResponse(state: UserAuthenticationState) {
    const [user, accessToken] = await Promise.all([
      this.usersService.findProfile(state.userId),
      this.jwtService.signAsync({
        sub: state.userId,
        email: state.email,
        authVersion: state.authVersion,
      }),
    ]);
    return { accessToken, user };
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid authentication credentials.');
    }
  }

  private async recordSecondFactorFailure(
    userId: string,
    context: SecurityRequestContext,
    now: Date,
  ) {
    await this.withTransaction(async (session) => {
      const credential = await this.throttleService.recordSecondFactorFailure(
        userId,
        now,
        session,
      );
      if (credential?.blockedUntil && credential.blockedUntil > now) {
        await this.auditService.record(
          userId,
          'two_factor.blocked',
          context,
          session,
        );
      }
    });
  }

  private isTransactionContention(error: unknown) {
    const candidate = error as {
      code?: unknown;
      errorLabels?: unknown;
      hasErrorLabel?: (label: string) => boolean;
    };
    return (
      candidate.code === 112 ||
      candidate.code === 251 ||
      (Array.isArray(candidate.errorLabels) &&
        candidate.errorLabels.includes('TransientTransactionError')) ||
      candidate.hasErrorLabel?.('TransientTransactionError') === true
    );
  }

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    let result!: T;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}
