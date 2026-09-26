import { INestApplicationContext } from '@nestjs/common';
import { AccountsService } from '../../modules/accounts/accounts/accounts.service';

type SeedAccountOptions = {
  archiveSaving?: boolean;
};

export async function seedAccounts(
  app: INestApplicationContext,
  userId: string,
  options: SeedAccountOptions = {},
) {
  const accounts = app.get(AccountsService);
  const balance = await accounts.create(userId, {
    name: 'Основной счёт',
    type: 'balance',
    currency: 'RUB',
    amount: 0,
  });
  const saving = await accounts.create(userId, {
    name: 'Накопления RUB',
    type: 'saving',
    currency: 'RUB',
    amount: 0,
  });
  const usdBalance = await accounts.create(userId, {
    name: 'Долларовый счёт',
    type: 'balance',
    currency: 'USD',
    amount: 2000,
  });
  const usdSaving = await accounts.create(userId, {
    name: 'Накопления USD',
    type: 'saving',
    currency: 'USD',
    amount: 500,
  });

  if (options.archiveSaving) {
    await accounts.archive(userId, saving._id.toString());
  }

  return {
    balanceAccountId: balance._id.toString(),
    savingAccountId: saving._id.toString(),
    usdBalanceAccountId: usdBalance._id.toString(),
    usdSavingAccountId: usdSaving._id.toString(),
  };
}
