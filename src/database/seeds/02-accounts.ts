import { personalBudget } from '../../common/utils/personal-budget.util';
import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account } from '../../modules/accounts/schemas/accounts.schema';
import { AccountsService } from '../../modules/accounts/accounts/accounts.service';

type SeedAccountOptions = {
  archiveSaving?: boolean;
};

export async function seedAccounts(
  app: INestApplicationContext,
  userId: string,
  options: SeedAccountOptions = {},
) {
  const accountModel = app.get<Model<Account>>(getModelToken(Account.name));

  const [balance, saving] = await Promise.all([
    accountModel.create({
      ...personalBudget(userId),
      type: 'balance',
    }),
    accountModel.create({ ...personalBudget(userId), type: 'saving' }),
  ]);

  if (options.archiveSaving) {
    await app.get(AccountsService).archive(userId, saving._id.toString());
  }

  return {
    balanceAccountId: balance._id.toString(),
    savingAccountId: saving._id.toString(),
  };
}
