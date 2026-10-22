import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
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

  async ensureIdExists(userId: string) {
    const user = await this.userModel.exists({ _id: userId, status: 'active' });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    return user._id;
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
