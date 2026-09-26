import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuthThrottleService } from './services/auth-throttle.service';
import { TwoFactorService } from './services/two-factor.service';
import { normalizeCurrency } from 'src/common/money/money';

const PASSWORD_SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH =
  '$2b$12$LozQb5QchK9TZRRm2qQ.HOzDU7FPx/JzHrN7N.iQZBkMp7Pc8w6jq';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly authThrottleService: AuthThrottleService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  async register(registerDto: RegisterDto) {
    const passwordHash = await bcrypt.hash(
      registerDto.password,
      PASSWORD_SALT_ROUNDS,
    );
    const user = await this.usersService.createWithPassword(
      {
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        email: registerDto.email,
        description: registerDto.notes,
        defaultCurrency: normalizeCurrency(registerDto.currency),
      },
      passwordHash,
    );

    return this.buildAuthResponse({
      userId: String(user._id),
      email: user.email,
    });
  }

  async login(loginDto: LoginDto, clientIp = 'unknown') {
    await this.authThrottleService.assertPasswordAllowed(
      loginDto.email,
      clientIp,
    );
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    const passwordsMatch = await bcrypt.compare(
      loginDto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user?.passwordHash || !passwordsMatch) {
      await this.authThrottleService.recordPasswordFailure(
        loginDto.email,
        clientIp,
      );
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.authThrottleService.resetPasswordFailures(
      loginDto.email,
      clientIp,
    );

    const userId = String(user._id);
    const twoFactorStatus = await this.twoFactorService.getStatus(userId);

    if (twoFactorStatus.status === 'enabled') {
      return this.twoFactorService.issueLoginChallenge(userId);
    }

    return this.buildAuthResponse({
      userId,
      email: user.email,
    });
  }

  private async buildAuthResponse(
    user: Pick<AuthenticatedUser, 'email' | 'userId'>,
  ) {
    const profile = await this.usersService.findProfile(user.userId);
    const authenticationState = await this.usersService.findAuthenticationState(
      user.userId,
    );
    const accessToken = await this.jwtService.signAsync({
      sub: user.userId,
      email: user.email,
      authVersion: authenticationState.authVersion,
    });

    return {
      accessToken,
      user: profile,
    };
  }
}
