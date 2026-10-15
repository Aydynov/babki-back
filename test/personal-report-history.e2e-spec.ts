import { endOfYear } from 'date-fns';
import request from 'supertest';
import type { PeriodReport } from '../src/modules/reports/interfaces/period-report.interface';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Personal report history (real MongoDB replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;

  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);

  afterAll(async () => {
    await harness?.close();
  }, 30000);

  it('includes previous years and matches income revenue for the same period', async () => {
    const server = harness.app.getHttpServer() as Parameters<typeof request>[0];
    const get = (path: string) =>
      request(server)
        .get(`/api/v1${path}`)
        .auth(harness.users[0].token, { type: 'bearer' });
    const post = (path: string, body: object) =>
      request(server)
        .post(`/api/v1${path}`)
        .auth(harness.users[0].token, { type: 'bearer' })
        .send(body);
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;
    const account = await post('/accounts', {
      name: 'Historical RUB',
      type: 'balance',
      currency: 'RUB',
      openedAt: `${previousYear}-03-01T12:00:00Z`,
      amount: 0,
    }).expect(201);
    const accountId = (account.body as { _id: string })._id;
    for (const [amount, transactionDate] of [
      [125, `${previousYear}-04-15T12:00:00Z`],
      [75, `${previousYear}-10-15T12:00:00Z`],
      [500, `${currentYear}-01-01T00:00:00Z`],
    ] as const) {
      await post('/incomes', { accountId, amount, transactionDate }).expect(
        201,
      );
    }

    const yearly = (await get('/reports/years').expect(200))
      .body as PeriodReport[];
    expect(yearly.map(({ period }) => period)).toEqual([
      String(previousYear),
      String(currentYear),
    ]);
    const historicalRub = yearly[0].currencies.find(
      ({ currency }) => currency === 'RUB',
    );
    expect(historicalRub?.incomes).toBe(200);
    expect(
      yearly[1].currencies.find(({ currency }) => currency === 'RUB')?.incomes,
    ).toBe(500);

    // Match the actual report aggregation boundaries, including its calendar end.
    const revenue = await get('/incomes/revenue')
      .query({
        currency: 'RUB',
        fromDate: `${previousYear}-01-01T00:00:00.000Z`,
        toDate: endOfYear(new Date(previousYear, 0, 1)).toISOString(),
      })
      .expect(200);
    expect((revenue.body as { currencies: object[] }).currencies).toEqual([
      { currency: 'RUB', totalRevenue: historicalRub?.incomes },
    ]);

    const monthly = (await get('/reports/months').expect(200))
      .body as PeriodReport[];
    expect(monthly[0].period).toBe(`${previousYear}-03`);
    expect(
      monthly
        .find(({ period }) => period === `${previousYear}-04`)
        ?.currencies.find(({ currency }) => currency === 'RUB')?.incomes,
    ).toBe(125);
  });
});
