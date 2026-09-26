import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { normalizeCurrency } from 'src/common/money/money';
import { personalBudget } from 'src/common/utils/personal-budget.util';
import type { AccountDocument } from '../accounts/schemas/accounts.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserDocument } from './schemas/user.schema';

export type UserProfile = Omit<User, 'authVersion' | 'passwordHash'> & {
  _id: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

export type UserAuthenticationState = {
  userId: string;
  email: string;
  authVersion: number;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async createWithPassword(createUserDto: CreateUserDto, passwordHash: string) {
    try {
      const user = await this.userModel.create({
        ...createUserDto,
        email: createUserDto.email.toLowerCase(),
        passwordHash,
      });

      return this.serializeUser(user.toObject());
    } catch (error) {
      this.handleDuplicateEmail(error);
    }
  }

  async findProfile(userId: string) {
    const user = await this.userModel
      .findOne({ _id: userId, status: 'active' })
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return this.serializeUser(user);
  }

  async findByEmailWithPassword(email: string) {
    return this.userModel
      .findOne({ email: email.toLowerCase(), status: 'active' })
      .select('+passwordHash')
      .lean()
      .exec();
  }

  async findByIdWithPassword(userId: string) {
    return this.userModel
      .findOne({ _id: userId, status: 'active' })
      .select('+passwordHash +authVersion')
      .lean()
      .exec();
  }

  async findAuthenticationState(
    userId: string,
  ): Promise<UserAuthenticationState> {
    const user = await this.userModel
      .findOne({ _id: userId, status: 'active' })
      .select('+authVersion email')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return {
      userId: String(user._id),
      email: user.email,
      authVersion: user.authVersion ?? 0,
    };
  }

  async incrementAuthVersion(
    userId: string,
    session: ClientSession,
  ): Promise<UserAuthenticationState> {
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: userId, status: 'active' },
        { $inc: { authVersion: 1 } },
        { returnDocument: 'after', session },
      )
      .select('+authVersion email')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return {
      userId: String(user._id),
      email: user.email,
      authVersion: user.authVersion ?? 0,
    };
  }

  async update(userId: string, updateUserDto: UpdateUserDto) {
    if (
      updateUserDto.defaultCurrency !== undefined ||
      Object.prototype.hasOwnProperty.call(updateUserDto, 'defaultAccountId')
    ) {
      return this.updateCurrencySettings(userId, updateUserDto);
    }
    try {
      const user = await this.userModel
        .findOneAndUpdate(
          { _id: userId, status: 'active' },
          {
            ...updateUserDto,
            ...(updateUserDto.email
              ? { email: updateUserDto.email.toLowerCase() }
              : {}),
          },
          { returnDocument: 'after', runValidators: true },
        )
        .lean()
        .exec();

      if (!user) {
        throw new NotFoundException(`User ${userId} not found.`);
      }

      return this.serializeUser(user);
    } catch (error) {
      this.handleDuplicateEmail(error);
    }
  }

  private async updateCurrencySettings(
    userId: string,
    updateUserDto: UpdateUserDto,
  ) {
    const session = await this.userModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const current = await this.userModel
          .findOne({ _id: userId, status: 'active' })
          .session(session)
          .lean()
          .exec();
        if (!current) throw new NotFoundException(`User ${userId} not found.`);

        const defaultCurrency = updateUserDto.defaultCurrency
          ? normalizeCurrency(updateUserDto.defaultCurrency)
          : current.defaultCurrency;
        let defaultAccountId = current.defaultAccountId ?? null;
        const hasExplicitAccount = 'defaultAccountId' in updateUserDto;
        const accountModel =
          this.userModel.db.model<AccountDocument>('Account');

        if (hasExplicitAccount) {
          defaultAccountId = updateUserDto.defaultAccountId
            ? new Types.ObjectId(updateUserDto.defaultAccountId)
            : null;
          if (defaultAccountId) {
            const account = await accountModel
              .findOne({
                _id: defaultAccountId,
                ...personalBudget(userId),
              })
              .session(session)
              .lean()
              .exec();
            if (!account)
              throw new NotFoundException(
                `Account ${defaultAccountId.toString()} not found.`,
              );
            if (
              account.type !== 'balance' ||
              account.archivedAt !== null ||
              account.currency !== defaultCurrency
            ) {
              throw new BadRequestException(
                'Default account must be an active balance in the default currency.',
              );
            }
          }
        } else if (
          updateUserDto.defaultCurrency !== undefined &&
          defaultAccountId
        ) {
          const account = await accountModel
            .findOne({ _id: defaultAccountId, ...personalBudget(userId) })
            .session(session)
            .lean()
            .exec();
          if (!account || account.currency !== defaultCurrency)
            defaultAccountId = null;
        }

        const { defaultAccountId: _account, ...profileFields } = updateUserDto;
        const user = await this.userModel
          .findOneAndUpdate(
            { _id: userId, status: 'active' },
            {
              ...profileFields,
              defaultCurrency,
              defaultAccountId,
              ...(updateUserDto.email
                ? { email: updateUserDto.email.toLowerCase() }
                : {}),
            },
            { returnDocument: 'after', runValidators: true, session },
          )
          .lean()
          .exec();
        if (!user) throw new NotFoundException(`User ${userId} not found.`);
        return this.serializeUser(user);
      });
    } finally {
      await session.endSession();
    }
  }

  async ensureIdExists(userId: string) {
    const user = await this.userModel.exists({ _id: userId, status: 'active' });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return user._id;
  }

  async selectFirstDefaultAccount(
    userId: string,
    accountId: Types.ObjectId,
    currency: string,
    session: ClientSession,
  ) {
    await this.userModel.updateOne(
      {
        _id: userId,
        status: 'active',
        defaultCurrency: currency,
        defaultAccountId: null,
      },
      { $set: { defaultAccountId: accountId } },
      { session },
    );
  }

  async clearDefaultAccount(
    userId: string,
    accountId: string,
    session: ClientSession,
  ) {
    await this.userModel.updateOne(
      { _id: userId, defaultAccountId: new Types.ObjectId(accountId) },
      { $set: { defaultAccountId: null } },
      { session },
    );
  }

  private handleDuplicateEmail(error: unknown): never {
    if ((error as { code?: number }).code === 11000) {
      throw new ConflictException('A user with this email already exists.');
    }

    throw error;
  }

  private serializeUser(user: UserDocument | Record<string, unknown>) {
    const profile = { ...(user as Record<string, unknown>) };
    delete profile.passwordHash;
    delete profile.authVersion;

    return profile as UserProfile;
  }
}
