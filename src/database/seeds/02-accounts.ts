import { INestApplicationContext } from '@nestjs/common';
import { SpaceWalletService } from '../../modules/space-finances/space-wallet.service';
import { getSeedDate } from './seed-date.utils';
export async function seedAccounts(
  app: INestApplicationContext,
  userId: string,
  spaceId: string,
  anchorDate: Date,
) {
  const accounts = app.get(SpaceWalletService);
  const balance = await accounts.create(spaceId, userId, {
    name: 'Основной счёт',
    type: 'balance',
    currency: 'RUB',
    openedAt: getSeedDate(-20, 1, anchorDate),
    amount: 0,
  });
  const saving = await accounts.create(spaceId, userId, {
    name: 'Накопления RUB',
    type: 'saving',
    currency: 'RUB',
    openedAt: getSeedDate(-20, 1, anchorDate),
    amount: 0,
  });
  const usdBalance = await accounts.create(spaceId, userId, {
    name: 'Долларовый счёт',
    type: 'balance',
    currency: 'USD',
    openedAt: getSeedDate(-20, 1, anchorDate),
    amount: 2000,
  });
  const usdSaving = await accounts.create(spaceId, userId, {
    name: 'Накопления USD',
    type: 'saving',
    currency: 'USD',
    openedAt: getSeedDate(-20, 1, anchorDate),
    amount: 500,
  });
  return {
    balanceAccountId: balance._id.toString(),
    savingAccountId: saving._id.toString(),
    usdBalanceAccountId: usdBalance._id.toString(),
    usdSavingAccountId: usdSaving._id.toString(),
  };
}
