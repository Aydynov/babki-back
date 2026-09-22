import { INestApplicationContext } from '@nestjs/common';
import { PlansService } from '../../modules/plans/plans.service';
import { CategoryMap } from './03-categories';
import { getSeedDate } from './seed-date.utils';

export async function seedPlans(
  app: INestApplicationContext,
  userId: string,
  categories: CategoryMap,
  anchorDate: Date,
) {
  const plansService = app.get(PlansService);

  // --- Active plans ---

  await plansService.create(userId, {
    description: 'Buy a MacBook Pro',
    targetDate: getSeedDate(3, 1, anchorDate),
    amount: 850000,
    categoryId: categories['Shopping'],
  });

  await plansService.create(userId, {
    description: 'Summer vacation fund',
    targetDate: getSeedDate(2, 1, anchorDate),
    amount: 350000,
    categoryId: categories['Entertainment'],
  });

  await plansService.create(userId, {
    description: 'Annual medical checkup',
    targetDate: getSeedDate(1, 20, anchorDate),
    amount: 45000,
    categoryId: categories['Health'],
  });

  // Target date in the past — plan is overdue but still active
  await plansService.create(userId, {
    description: 'Replace old bicycle',
    targetDate: getSeedDate(-1, 1, anchorDate),
    amount: 80000,
    categoryId: categories['Transport'],
  });

  // --- Closed plans ---

  // Closed early (before target date), same amount as planned
  const smartphone = await plansService.create(userId, {
    description: 'Buy a new smartphone',
    targetDate: getSeedDate(-2, 20, anchorDate),
    amount: 250000,
    categoryId: categories['Shopping'],
  });
  await plansService.close(userId, String(smartphone._id), {
    closingDate: getSeedDate(-2, 15, anchorDate),
  });

  // Closed on time, description overridden
  const internet = await plansService.create(userId, {
    description: 'Home internet upgrade',
    targetDate: getSeedDate(-3, 15, anchorDate),
    amount: 35000,
    categoryId: categories['Utilities'],
  });
  await plansService.close(userId, String(internet._id), {
    closingDate: getSeedDate(-3, 15, anchorDate),
    description: 'Bought new router and switched plan',
  });

  // Closed late (after target date), amount overridden (spent more than planned)
  const dinner = await plansService.create(userId, {
    description: 'Birthday dinner',
    targetDate: getSeedDate(-4, 10, anchorDate),
    amount: 22000,
    categoryId: categories['Food & Dining'],
  });
  await plansService.close(userId, String(dinner._id), {
    closingDate: getSeedDate(-4, 15, anchorDate),
    amount: 25000,
  });
  await plansService.archive(userId, String(dinner._id));
}
