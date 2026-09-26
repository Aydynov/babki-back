import { INestApplicationContext } from '@nestjs/common';
import { IncomesService } from '../../modules/transactions/incomes/incomes.service';
import { ExpensesService } from '../../modules/transactions/expenses/expenses.service';
import { TransfersService } from '../../modules/transactions/transfers/transfers.service';
import { TransactionsService } from '../../modules/transactions/transactions/transactions.service';
import { CategoryMap } from './03-categories';
import { getSeedDate } from './seed-date.utils';

export async function seedTransactions(
  app: INestApplicationContext,
  userId: string,
  balanceAccountId: string,
  savingAccountId: string,
  usdBalanceAccountId: string,
  usdSavingAccountId: string,
  categories: CategoryMap,
  anchorDate: Date,
) {
  const incomes = app.get(IncomesService);
  const expenses = app.get(ExpensesService);
  const transfers = app.get(TransfersService);
  const transactions = app.get(TransactionsService);

  // ── Rolling transaction history ─────────────────────────────────────────────

  // Month -19
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-19, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 45000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-19, 10, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-19, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-19, 20, anchorDate),
    description: 'Electricity + internet',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-19, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -18
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-18, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 42000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-18, 8, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-18, 10, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-18, 18, anchorDate),
    description: 'Electricity bill',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-18, 22, anchorDate),
    description: 'Dentist visit',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-18, 26, anchorDate),
    description: 'Monthly savings',
  });

  // Month -17
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-17, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 50000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-17, 10, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-17, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 35000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-17, 20, anchorDate),
    description: 'Spring clothes',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-17, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -16
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-16, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 55000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-16, 8, anchorDate),
    description: 'Groceries + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-16, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-16, 20, anchorDate),
    description: 'Concerts and events',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-16, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -15
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-15, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 48000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-15, 7, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-15, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-15, 18, anchorDate),
    description: 'Internet + electricity',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-15, 25, anchorDate),
    description: 'Streaming subscriptions',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-15, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -14
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-14, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 60000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-14, 5, anchorDate),
    description: 'Groceries + dining out',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-14, 12, anchorDate),
    description: 'Monthly transit pass + taxi',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 45000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-14, 20, anchorDate),
    description: 'Summer wardrobe',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-14, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -13
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-13, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 120000,
    transactionDate: getSeedDate(-13, 15, anchorDate),
    description: 'Freelance project bonus',
    source: 'Client',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 65000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-13, 10, anchorDate),
    description: 'Vacation food + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 25000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-13, 12, anchorDate),
    description: 'Flights + transfers',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 80000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-13, 20, anchorDate),
    description: 'Summer travel',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-13, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -12
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-12, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 50000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-12, 8, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-12, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-12, 20, anchorDate),
    description: 'Electricity + internet',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-12, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -11
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-11, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 52000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-11, 7, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-11, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-11, 18, anchorDate),
    description: 'Electricity + internet',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-11, 25, anchorDate),
    description: 'Annual medical checkup',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-11, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -10
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-10, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 80000,
    transactionDate: getSeedDate(-10, 10, anchorDate),
    description: 'Year-end bonus',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 55000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-10, 8, anchorDate),
    description: 'Groceries + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-10, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 60000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-10, 20, anchorDate),
    description: 'Winter clothes',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-10, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -9
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-9, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 58000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-9, 7, anchorDate),
    description: 'Groceries + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 16000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-9, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 25000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-9, 18, anchorDate),
    description: 'Electricity + internet',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-9, 25, anchorDate),
    description: 'Cinema + events',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-9, 28, anchorDate),
    description: 'Monthly savings',
  });

  // Month -8
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-8, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 50000,
    transactionDate: getSeedDate(-8, 15, anchorDate),
    description: 'New Year bonus',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 70000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-8, 10, anchorDate),
    description: 'Holiday groceries + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-8, 12, anchorDate),
    description: 'Taxi + transit',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 80000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-8, 20, anchorDate),
    description: 'New Year gifts',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 30000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-8, 28, anchorDate),
    description: 'New Year events',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-8, 28, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -7 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-7, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 48000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-7, 8, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-7, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-7, 20, anchorDate),
    description: 'Electricity + internet',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-7, 28, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -6 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-6, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 44000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-6, 8, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-6, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 10000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-6, 20, anchorDate),
    description: 'Streaming subscriptions',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-6, 26, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -5 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-5, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 28000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-5, 10, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-5, 12, anchorDate),
    description: 'Monthly transit pass',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-5, 20, anchorDate),
    description: 'Electricity bill',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-5, 25, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -4 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-4, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 42000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-4, 8, anchorDate),
    description: 'Groceries + restaurant',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 12000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-4, 15, anchorDate),
    description: 'Cinema tickets',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 75000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-4, 20, anchorDate),
    description: 'Clothes',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-4, 28, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -3 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-3, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 36000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-3, 7, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 25000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-3, 14, anchorDate),
    description: 'Doctor visit',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-3, 22, anchorDate),
    description: 'Internet + electricity',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 9000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-3, 25, anchorDate),
    description: 'Streaming subscriptions',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-3, 28, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -2 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-2, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 40000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-2, 3, anchorDate),
    description: 'Groceries',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 8000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-2, 5, anchorDate),
    description: 'Taxi',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 21000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-2, 12, anchorDate),
    description: 'Internet + electricity',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(-2, 18, anchorDate),
    description: 'Pharmacy',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 14000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-2, 22, anchorDate),
    description: 'Cinema and subscriptions',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-2, 28, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month -1 ─────────────────────────────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(-1, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 52000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(-1, 7, anchorDate),
    description: 'Groceries + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(-1, 11, anchorDate),
    description: 'Monthly transit pass + taxi',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 23000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(-1, 16, anchorDate),
    description: 'Internet + electricity',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 18000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-1, 20, anchorDate),
    description: 'Cinema and subscriptions',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 32000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(-1, 24, anchorDate),
    description: 'Summer clothes',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(-1, 25, anchorDate),
    description: 'Monthly savings',
  });

  // ── Month 0 (complete anchor month) ──────────────────────────────────────────
  await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 350000,
    transactionDate: getSeedDate(0, 1, anchorDate),
    description: 'Salary',
    source: 'Employer',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 48000,
    categoryId: categories['Food & Dining'],
    transactionDate: getSeedDate(0, 4, anchorDate),
    description: 'Groceries + restaurants',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 16000,
    categoryId: categories['Transport'],
    transactionDate: getSeedDate(0, 8, anchorDate),
    description: 'Monthly transit pass + taxi',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 22000,
    categoryId: categories['Utilities'],
    transactionDate: getSeedDate(0, 12, anchorDate),
    description: 'Internet + electricity',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 15000,
    categoryId: categories['Health'],
    transactionDate: getSeedDate(0, 16, anchorDate),
    description: 'Pharmacy and checkup',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 20000,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(0, 20, anchorDate),
    description: 'Cinema and subscriptions',
  });
  await expenses.create(userId, {
    accountId: balanceAccountId,
    amount: 28000,
    categoryId: categories['Shopping'],
    transactionDate: getSeedDate(0, 24, anchorDate),
    description: 'Seasonal clothes',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: savingAccountId,
    sourceAmount: 50000,
    destinationAmount: 50000,
    transactionDate: getSeedDate(0, 28, anchorDate),
    description: 'Monthly savings',
  });

  const deletedIncome = await incomes.create(userId, {
    accountId: balanceAccountId,
    amount: 1234,
    transactionDate: getSeedDate(0, 27, anchorDate),
    description: 'Deletion test: soft-deleted income',
    source: 'Lifecycle fixture',
  });
  await transactions.delete(userId, String(deletedIncome._id));

  await incomes.create(userId, {
    accountId: usdBalanceAccountId,
    amount: 750,
    transactionDate: getSeedDate(-1, 5, anchorDate),
    description: 'USD freelance income',
    source: 'International client',
  });
  await expenses.create(userId, {
    accountId: usdBalanceAccountId,
    amount: 120,
    categoryId: categories['Entertainment'],
    transactionDate: getSeedDate(-1, 8, anchorDate),
    description: 'USD subscription bundle',
  });
  await transfers.create(userId, {
    sourceAccountId: balanceAccountId,
    destinationAccountId: usdSavingAccountId,
    sourceAmount: 90000,
    destinationAmount: 1000,
    transactionDate: getSeedDate(-2, 12, anchorDate),
    description: 'Backdated RUB to USD conversion',
  });
}
