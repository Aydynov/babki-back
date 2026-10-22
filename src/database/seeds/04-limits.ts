import { INestApplicationContext } from '@nestjs/common';
import { SpaceSettingsService } from '../../modules/space-finances/space-settings.service';
import { CategoryMap } from './03-categories';
import { getSeedMonthRange } from './seed-date.utils';
export async function seedLimits(
  app: INestApplicationContext,
  userId: string,
  spaceId: string,
  categories: CategoryMap,
  anchorDate: Date,
) {
  const limitsService = app.get(SpaceSettingsService);
  const { startDate, endDate } = getSeedMonthRange(0, anchorDate);
  await limitsService.saveLimit(spaceId, userId, {
    currency: 'RUB',
    categoryId: categories['Food & Dining'],
    total: 65000,
    startDate,
    endDate,
  });
  await limitsService.saveLimit(spaceId, userId, {
    currency: 'RUB',
    categoryId: categories['Entertainment'],
    total: 25000,
    startDate,
    endDate,
  });
  await limitsService.saveLimit(spaceId, userId, {
    currency: 'USD',
    categoryId: categories['Entertainment'],
    total: 300,
    startDate,
    endDate,
  });
}
