import { INestApplicationContext } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../modules/users/users.service';

export async function seedUsers(app: INestApplicationContext) {
  const usersService = app.get(UsersService);
  const passwordHash = await bcrypt.hash('Test1234!', 12);
  const definitions = [
    {
      key: 'alex',
      firstName: 'Alex',
      lastName: 'Testov',
      email: 'test@test.com',
    },
    {
      key: 'maria',
      firstName: 'Maria',
      lastName: 'Testova',
      email: 'maria@test.com',
    },
    {
      key: 'ivan',
      firstName: 'Ivan',
      lastName: 'Petrov',
      email: 'ivan@test.com',
    },
    {
      key: 'elena',
      firstName: 'Elena',
      lastName: 'Sidorova',
      email: 'elena@test.com',
    },
  ] as const;
  const users = {} as Record<(typeof definitions)[number]['key'], string>;
  for (const definition of definitions) {
    const user = await usersService.createWithPassword(
      {
        firstName: definition.firstName,
        lastName: definition.lastName,
        email: definition.email,
      },
      passwordHash,
    );
    users[definition.key] = String(user._id);
  }
  return { userId: users.alex, users, password: 'Test1234!' };
}
