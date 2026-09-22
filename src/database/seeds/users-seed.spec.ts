import { INestApplicationContext } from '@nestjs/common';
import { seedUsers } from './01-users';

describe('development users seed', () => {
  it('provides a dedicated active user for account-deletion testing', async () => {
    const usersService = {
      createWithPassword: jest
        .fn()
        .mockImplementation((dto: { email: string }) => ({ _id: dto.email })),
    };
    const app = {
      get: jest.fn(() => usersService),
    } as unknown as INestApplicationContext;

    const result = await seedUsers(app);

    expect(usersService.createWithPassword).toHaveBeenCalledTimes(5);
    expect(result.users.deletionCandidate).toBe('delete-me@test.com');
  });
});
