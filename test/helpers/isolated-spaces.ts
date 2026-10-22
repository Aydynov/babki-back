import request from 'supertest';
import { startSpacesTestApp } from './spaces-test-app';

/** Independent spaces used as controls in cross-space isolation regressions. */
export async function createIsolatedSpaces(
  context: Awaited<ReturnType<typeof startSpacesTestApp>>,
) {
  const ids: string[] = [];
  for (const [index, user] of context.users.entries()) {
    const response = await request(
      context.app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/api/v1/spaces')
      .auth(user.token, { type: 'bearer' })
      .send({ name: `Independent ${index}` })
      .expect(201);
    ids.push((response.body as { id: string }).id);
  }
  return ids;
}

export function isolatedFinancialPath(spaceId: string, path: string) {
  return /^\/(accounts|incomes|expenses|transactions|transfers|expense-categories|expense-limits|plans|debts|reports)(\/|\?|$)/.test(
    path,
  )
    ? `/spaces/${spaceId}${path}`
    : path;
}
