import { INestApplicationContext } from '@nestjs/common';
import { SpaceDebtsService } from '../../modules/space-finances/space-debts.service';
import { getSeedDate } from './seed-date.utils';
export async function seedDebts(
  app: INestApplicationContext,
  userId: string,
  spaceId: string,
  anchorDate: Date,
) {
  const debtsService = app.get(SpaceDebtsService);
  // Debt 1 — Артур: active, 3 partial repayments, 15,000 remaining
  const debtArtur = await debtsService.create(spaceId, userId, {
    currency: 'RUB',
    debtor: 'Артур',
    principalAmount: 50000,
    description: 'Loan for car repair',
    dueDate: getSeedDate(2, 1, anchorDate),
  });
  await debtsService.repay(spaceId, userId, String(debtArtur._id), {
    repaymentDate: getSeedDate(-4, 10, anchorDate),
    amount: 20000,
    description: 'First repayment',
    isIncome: false,
  });
  await debtsService.repay(spaceId, userId, String(debtArtur._id), {
    repaymentDate: getSeedDate(-2, 15, anchorDate),
    amount: 10000,
    description: 'Second repayment',
    isIncome: false,
  });
  await debtsService.repay(spaceId, userId, String(debtArtur._id), {
    repaymentDate: getSeedDate(0, 5, anchorDate),
    amount: 5000,
    description: 'Current month repayment',
    isIncome: false,
  });
  // Debt 2 — Мария: fully repaid → status auto-set to 'closed'
  const debtMaria = await debtsService.create(spaceId, userId, {
    currency: 'RUB',
    debtor: 'Мария',
    principalAmount: 100000,
    description: 'Loan for vacation',
  });
  await debtsService.repay(spaceId, userId, String(debtMaria._id), {
    repaymentDate: getSeedDate(-3, 20, anchorDate),
    amount: 100000,
    description: 'Full repayment',
    isIncome: false,
  });
  await debtsService.archive(spaceId, userId, String(debtMaria._id));
  // Debt 3 — no repayments or generated income, safe for physical deletion.
  await debtsService.create(spaceId, userId, {
    currency: 'RUB',
    debtor: 'Deletion test: unused debt',
    principalAmount: 1000,
    description: 'Safe to delete because it has no financial history',
  });
  await debtsService.create(spaceId, userId, {
    currency: 'USD',
    debtor: 'International borrower',
    principalAmount: 1200,
    description: 'USD debt scenario',
  });
}
