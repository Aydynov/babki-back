import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ConfirmTwoFactorSetupDto } from './dto/confirm-two-factor-setup.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { LoginDto } from './dto/login.dto';
import { RegenerateRecoveryCodesDto } from './dto/regenerate-recovery-codes.dto';
import { RegisterDto } from './dto/register.dto';
import { TwoFactorLoginDto } from './dto/two-factor-login.dto';
import { TwoFactorSetupDto } from './dto/two-factor-setup.dto';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import type { SecurityRequestContext } from './services/security-audit.service';
import { TwoFactorService } from './services/two-factor.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UserDeletionService } from '../users/user-deletion.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
    private readonly userDeletionService: UserDeletionService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  login(@Body() loginDto: LoginDto, @Req() request: Request) {
    return this.authService.login(loginDto, request.ip);
  }

  @Public()
  @Post('login/two-factor')
  completeTwoFactorLogin(
    @Body() loginDto: TwoFactorLoginDto,
    @Req() request: Request,
  ) {
    return this.twoFactorService.completeLogin(
      loginDto.challengeToken,
      loginDto.method,
      loginDto.code,
      this.requestContext(request),
    );
  }

  @Get('two-factor')
  twoFactorStatus(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.twoFactorService.getStatus(currentUser.userId);
  }

  @Post('account-deletion')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestAccountDeletion(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ) {
    await this.twoFactorService.assertDeletionStepUp(
      currentUser.userId,
      dto.password,
      dto.secondFactorCode,
    );
    await this.userDeletionService.request(currentUser.userId);
  }

  @Post('two-factor/setup')
  startTwoFactorSetup(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() setupDto: TwoFactorSetupDto,
  ) {
    return this.twoFactorService.startSetup(
      currentUser.userId,
      setupDto.password,
    );
  }

  @Post('two-factor/setup/confirm')
  confirmTwoFactorSetup(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() confirmDto: ConfirmTwoFactorSetupDto,
    @Req() request: Request,
  ) {
    return this.twoFactorService.confirmSetup(
      currentUser.userId,
      confirmDto.token,
      this.requestContext(request),
    );
  }

  @Post('two-factor/disable')
  disableTwoFactor(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() disableDto: DisableTwoFactorDto,
    @Req() request: Request,
  ) {
    return this.twoFactorService.disable(
      currentUser.userId,
      disableDto.password,
      disableDto.method,
      disableDto.code,
      this.requestContext(request),
    );
  }

  @Post('two-factor/recovery/regenerate')
  regenerateRecoveryCodes(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() regenerateDto: RegenerateRecoveryCodesDto,
    @Req() request: Request,
  ) {
    return this.twoFactorService.regenerateRecoveryCodes(
      currentUser.userId,
      regenerateDto.password,
      regenerateDto.token,
      this.requestContext(request),
    );
  }

  private requestContext(request: Request): SecurityRequestContext {
    return {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
