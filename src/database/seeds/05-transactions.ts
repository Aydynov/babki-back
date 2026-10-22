import { INestApplicationContext } from '@nestjs/common';
import { SpaceTransactionsService } from '../../modules/space-finances/space-transactions.service';
import { SpaceTransfersService } from '../../modules/space-finances/space-transfers.service';
import { CategoryMap } from './03-categories';
import { getSeedDate } from './seed-date.utils';
export async function seedTransactions(
  app: INestApplicationContext,
  userId: string,
  spaceId: string,
  balanceAccountId: string,
  savingAccountId: string,
  usdBalanceAccountId: string,
  usdSavingAccountId: string,
  categories: CategoryMap,
  anchorDate: Date,
) {
  const transactions = app.get(SpaceTransactionsService);
  const transfers = app.get(SpaceTransfersService);
  // ── Rolling transaction history ─────────────────────────────────────────────
  // Month -19
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-19, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 45000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-19, 10, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-19, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-19, 20, anchorDate),
    description: 'Electricity + internet',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-19, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -18
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-18, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 42000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-18, 8, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-18, 10, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-18, 18, anchorDate),
    description: 'Electricity bill',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-18, 22, anchorDate),
    description: 'Dentist visit',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-18, 26, anchorDate),
    description: 'Monthly savings',
  });
  // Month -17
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-17, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 50000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-17, 10, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-17, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 35000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-17, 20, anchorDate),
    description: 'Spring clothes',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-17, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -16
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-16, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 55000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-16, 8, anchorDate),
    description: 'Groceries + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-16, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-16, 20, anchorDate),
    description: 'Concerts and events',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-16, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -15
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-15, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 48000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-15, 7, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-15, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-15, 18, anchorDate),
    description: 'Internet + electricity',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-15, 25, anchorDate),
    description: 'Streaming subscriptions',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-15, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -14
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-14, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 60000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-14, 5, anchorDate),
    description: 'Groceries + dining out',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-14, 12, anchorDate),
    description: 'Monthly transit pass + taxi',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 45000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-14, 20, anchorDate),
    description: 'Summer wardrobe',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-14, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -13
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-13, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 120000,
    transactionDate: getSeedDate(-13, 15, anchorDate),
    description: 'Freelance project bonus',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 65000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-13, 10, anchorDate),
    description: 'Vacation food + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 25000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-13, 12, anchorDate),
    description: 'Flights + transfers',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 80000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-13, 20, anchorDate),
    description: 'Summer travel',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-13, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -12
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-12, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 50000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-12, 8, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-12, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-12, 20, anchorDate),
    description: 'Electricity + internet',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-12, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -11
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-11, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 52000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-11, 7, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-11, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-11, 18, anchorDate),
    description: 'Electricity + internet',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-11, 25, anchorDate),
    description: 'Annual medical checkup',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-11, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -10
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-10, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 80000,
    transactionDate: getSeedDate(-10, 10, anchorDate),
    description: 'Year-end bonus',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 55000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-10, 8, anchorDate),
    description: 'Groceries + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-10, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 60000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-10, 20, anchorDate),
    description: 'Winter clothes',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-10, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -9
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-9, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 58000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-9, 7, anchorDate),
    description: 'Groceries + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 16000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-9, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 25000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-9, 18, anchorDate),
    description: 'Electricity + internet',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-9, 25, anchorDate),
    description: 'Cinema + events',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-9, 28, anchorDate),
    description: 'Monthly savings',
  });
  // Month -8
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-8, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 50000,
    transactionDate: getSeedDate(-8, 15, anchorDate),
    description: 'New Year bonus',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 70000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-8, 10, anchorDate),
    description: 'Holiday groceries + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-8, 12, anchorDate),
    description: 'Taxi + transit',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 80000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-8, 20, anchorDate),
    description: 'New Year gifts',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 30000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-8, 28, anchorDate),
    description: 'New Year events',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-8, 28, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -7 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-7, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 48000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-7, 8, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-7, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-7, 20, anchorDate),
    description: 'Electricity + internet',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-7, 28, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -6 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-6, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 44000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-6, 8, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-6, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 10000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-6, 20, anchorDate),
    description: 'Streaming subscriptions',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-6, 26, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -5 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-5, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 28000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-5, 10, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-5, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-5, 20, anchorDate),
    description: 'Electricity bill',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-5, 25, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -4 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-4, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 42000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-4, 8, anchorDate),
    description: 'Groceries + restaurant',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-4, 15, anchorDate),
    description: 'Cinema tickets',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 75000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-4, 20, anchorDate),
    description: 'Clothes',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-4, 28, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -3 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-3, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 36000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-3, 7, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 25000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-3, 14, anchorDate),
    description: 'Doctor visit',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-3, 22, anchorDate),
    description: 'Internet + electricity',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 9000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-3, 25, anchorDate),
    description: 'Streaming subscriptions',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-3, 28, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -2 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-2, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 40000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-2, 3, anchorDate),
    description: 'Groceries',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 8000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-2, 5, anchorDate),
    description: 'Taxi',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 21000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-2, 12, anchorDate),
    description: 'Internet + electricity',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-2, 18, anchorDate),
    description: 'Pharmacy',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 14000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-2, 22, anchorDate),
    description: 'Cinema and subscriptions',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-2, 28, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month -1 ─────────────────────────────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-1, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 52000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-1, 7, anchorDate),
    description: 'Groceries + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-1, 11, anchorDate),
    description: 'Monthly transit pass + taxi',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 23000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-1, 16, anchorDate),
    description: 'Internet + electricity',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-1, 20, anchorDate),
    description: 'Cinema and subscriptions',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 32000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-1, 24, anchorDate),
    description: 'Summer clothes',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-1, 25, anchorDate),
    description: 'Monthly savings',
  });
  // ── Month 0 (complete anchor month) ──────────────────────────────────────────
  await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(0, 1, anchorDate),
    description: 'Salary',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 48000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(0, 4, anchorDate),
    description: 'Groceries + restaurants',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 16000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(0, 8, anchorDate),
    description: 'Monthly transit pass + taxi',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(0, 12, anchorDate),
    description: 'Internet + electricity',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(0, 16, anchorDate),
    description: 'Pharmacy and checkup',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(0, 20, anchorDate),
    description: 'Cinema and subscriptions',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: balanceAccountId,
    amount: 28000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(0, 24, anchorDate),
    description: 'Seasonal clothes',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(0, 28, anchorDate),
    description: 'Monthly savings',
  });
  const deletedIncome = await transactions.create(spaceId, userId, 'income', {
    accountId: balanceAccountId,
    amount: 1234,
    transactionDate: getSeedDate(0, 27, anchorDate),
    description: 'Deletion test: soft-deleted income',
  });
  await transactions.change(
    spaceId,
    userId,
    String(deletedIncome._id),
    'income',
  );
  await transactions.create(spaceId, userId, 'income', {
    accountId: usdBalanceAccountId,
    amount: 750,
    transactionDate: getSeedDate(-1, 5, anchorDate),
    description: 'USD freelance income',
  });
  await transactions.create(spaceId, userId, 'expense', {
    accountId: usdBalanceAccountId,
    amount: 120,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-1, 8, anchorDate),
    description: 'USD subscription bundle',
  });
  await transfers.create(spaceId, userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: usdSavingAccountId,
    sourceAmount: 90000,
    destinationAmount: 1000,
    transactionDate: getSeedDate(-2, 12, anchorDate),
    description: 'Backdated RUB to USD conversion',
  });
}
