import { INestApplicationContext } from '@nestjs/common';
import { ExpenseCategoriesService } from '../../modules/expense-categories/expense-categories.service';

export type CategoryMap = Record<string, string>;

const CATEGORIES = [
  { name: 'Food & Dining', color: '#FF6B6B' },
  { name: 'Transport', color: '#4ECDC4' },
  { name: 'Entertainment', color: '#45B7D1' },
  { name: 'Utilities', color: '#FFA07A' },
  { name: 'Health', color: '#98D8C8' },
  { name: 'Shopping', color: '#DDA0DD' },
  { name: 'Deletion test: unused', color: '#A0A0A0' },
  { name: 'Deletion test: archived', color: '#707070' },
] as const;

export async function seedCategories(
  app: INestApplicationContext,
  userId: string,
): Promise<CategoryMap> {
  const categoriesService = app.get(ExpenseCategoriesService);
  const result: CategoryMap = {};

  for (const cat of CATEGORIES) {
    const created = await categoriesService.create(userId, {
      name: cat.name,
      color: cat.color,
    });
    result[cat.name] = String(created._id);
  }

  await categoriesService.update(userId, result['Deletion test: archived'], {
    isArchived: true,
  });

  return result;
}
