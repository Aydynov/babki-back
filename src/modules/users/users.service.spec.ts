import type { ClientSession } from 'mongoose';
import { UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService authentication state', () => {
  const userId = '507f1f77bcf86cd799439011';
  const session = {} as ClientSession;
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const select = jest.fn(() => ({ lean }));
  const userModel = {
    findById: jest.fn(() => ({ select, lean })),
    findByIdAndUpdate: jest.fn(() => ({ select })),
    findOne: jest.fn(() => ({ select, lean })),
    findOneAndUpdate: jest.fn(() => ({ select, lean })),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(userModel as never);
  });

  it('hides authentication version with a zero default', () => {
    expect(UserSchema.path('authVersion').options).toMatchObject({
      default: 0,
      select: false,
    });
  });

  it('returns only the minimal authentication state', async () => {
    exec.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      authVersion: 3,
      firstName: 'Ada',
      passwordHash: 'hidden',
    });

    await expect(service.findAuthenticationState(userId)).resolves.toEqual({
      userId,
      email: 'ada@example.com',
      authVersion: 3,
    });
    expect(select).toHaveBeenCalledWith('+authVersion email');
    expect(userModel.findOne).toHaveBeenCalledWith({
      _id: userId,
      status: 'active',
    });
  });

  it('selects password and authentication version for step-up checks', async () => {
    const record = {
      _id: userId,
      email: 'ada@example.com',
      passwordHash: 'hash',
      authVersion: 1,
    };
    exec.mockResolvedValue(record);

    await expect(service.findByIdWithPassword(userId)).resolves.toEqual(record);
    expect(select).toHaveBeenCalledWith('+passwordHash +authVersion');
  });

  it('increments authentication version in the caller transaction', async () => {
    exec.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
      authVersion: 2,
    });

    await expect(
      service.incrementAuthVersion(userId, session),
    ).resolves.toEqual({
      userId,
      email: 'ada@example.com',
      authVersion: 2,
    });
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: userId, status: 'active' },
      { $inc: { authVersion: 1 } },
      { returnDocument: 'after', session },
    );
  });

  it('never returns hidden authentication fields in a profile', async () => {
    userModel.findOne.mockReturnValueOnce({
      lean: () => ({
        exec: () =>
          Promise.resolve({
            _id: userId,
            email: 'ada@example.com',
            firstName: 'Ada',
            passwordHash: 'hash',
            authVersion: 9,
          }),
      }),
    });

    await expect(service.findProfile(userId)).resolves.toEqual({
      _id: userId,
      email: 'ada@example.com',
      firstName: 'Ada',
    });
  });
});
