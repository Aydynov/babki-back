import { ValidationPipe } from '@nestjs/common';
import { RegisterDto } from '../auth/dto/register.dto';
import { UpdateUserDto } from './dto/update-user.dto';

describe('Identity profile contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const registration = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    password: 'test-password',
  };

  it('registers without financial settings', async () => {
    await expect(
      pipe.transform(registration, { type: 'body', metatype: RegisterDto }),
    ).resolves.toEqual(registration);
  });

  it('rejects the removed registration currency', async () => {
    await expect(
      pipe.transform(
        { ...registration, currency: 'USD' },
        {
          type: 'body',
          metatype: RegisterDto,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['defaultCurrency', 'defaultAccountId'])(
    'rejects removed profile field %s',
    async (field) => {
      await expect(
        pipe.transform(
          { [field]: 'USD' },
          {
            type: 'body',
            metatype: UpdateUserDto,
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});
