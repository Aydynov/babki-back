import { INestApplicationContext } from '@nestjs/common';
import { SpaceSettingsService } from '../../modules/space-finances/space-settings.service';
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
  spaceId: string,
): Promise<CategoryMap> {
  const categoriesService = app.get(SpaceSettingsService);
  const result: CategoryMap = {};
  for (const cat of CATEGORIES) {
    const created = await categoriesService.saveCategory(spaceId, userId, {
      name: cat.name,
      color: cat.color,
    });
    result[cat.name] = String(created._id);
  }
  await categoriesService.saveCategory(
    spaceId,
    userId,
    { isArchived: true },
    result['Deletion test: archived'],
  );
  return result;
}
