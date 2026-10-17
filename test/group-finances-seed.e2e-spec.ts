import { Types } from 'mongoose';
import request from 'supertest';
import { PeriodReport } from '../src/modules/reports/interfaces/period-report.interface';
import { seedGroups } from '../src/database/seeds/08-groups';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group finances development seed (real replica set)', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;

  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);

  afterAll(async () => {
    await fixture?.close();
  });

  it('creates independent manual-testing scenarios', async () => {
    const [alex, maria, ivan, elena] = fixture.users;
    const result = await seedGroups(
      fixture.app,
      {
        alex: alex.id,
        maria: maria.id,
        ivan: ivan.id,
        elena: elena.id,
      },
      new Date('2024-03-21T12:00:00.000Z'),
    );
    const groupIds = [
      result.family.id,
      result.studio.id,
      result.agency.id,
      result.sandbox.id,
    ].map((id) => new Types.ObjectId(id));

    expect(
      await fixture.connection.collection('groups').countDocuments({
        _id: { $in: groupIds },
      }),
    ).toBe(4);
    expect(
      await fixture.connection.collection('accounts').countDocuments({
        ownerType: 'group',
        ownerId: { $in: groupIds },
      }),
    ).toBe(5);
    expect(
      await fixture.connection.collection('transactions').countDocuments({
        ownerType: 'group',
        ownerId: { $in: groupIds },
      }),
    ).toBe(12);

    for (const collection of ['accounts', 'transactions', 'expenselimits']) {
      expect(
        await fixture.connection.collection(collection).countDocuments({
          ownerType: 'group',
          ownerId: { $in: groupIds },
          type: { $ne: 'transfer' },
          currency: { $ne: 'USD' },
        }),
      ).toBe(0);
    }

    expect(
      await fixture.connection.collection('transactions').countDocuments({
        ownerType: 'group',
        ownerId: { $in: groupIds },
        deletedAt: null,
      }),
    ).toBe(11);
    expect(
      await fixture.connection.collection('debttransactions').countDocuments({
        ownerType: 'group',
        ownerId: new Types.ObjectId(result.family.id),
      }),
    ).toBe(4);
    for (const member of [alex, maria]) {
      const debtsResponse = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${result.family.id}/debts`)
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      const debts = debtsResponse.body as {
        items: {
          _id: string;
          principalAmount: number;
          remainingAmount: number;
          status: string;
        }[];
        total: number;
      };
      expect(debts.total).toBe(2);
      expect(debts.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            principalAmount: 4000,
            remainingAmount: 2500,
            status: 'active',
          }),
          expect.objectContaining({
            principalAmount: 1000,
            remainingAmount: 0,
            status: 'closed',
          }),
        ]),
      );
      const activeDebt = debts.items.find((debt) => debt.status === 'active')!;
      const repaymentsResponse = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(
          `/api/v1/groups/${result.family.id}/debts/${activeDebt._id}/repayments`,
        )
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      const repaymentRows = repaymentsResponse.body as {
        total: number;
        items: {
          amount: number;
          isIncome: boolean;
          incomeId?: string;
          cancelledAt: string | null;
          cancelledByActor?: { userId: string };
        }[];
      };
      expect(repaymentRows.total).toBe(3);
      expect(repaymentRows.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            amount: 1200,
            isIncome: true,
            cancelledAt: null,
            incomeId: expect.any(String) as string,
          }),
          expect.objectContaining({
            amount: 300,
            isIncome: false,
            cancelledAt: null,
          }),
          expect.objectContaining({
            amount: 500,
            isIncome: true,
            cancelledAt: expect.any(String) as string,
            cancelledByActor: expect.objectContaining({
              userId: alex.id,
            }) as object,
          }),
        ]),
      );
      const reversed = repaymentRows.items.find((row) => row.amount === 500)!;
      await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${result.family.id}/incomes/${reversed.incomeId}`)
        .auth(member.token, { type: 'bearer' })
        .expect(404);
      const plans = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${result.family.id}/plans`)
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      const planRows = plans.body as {
        items: { status: string; amount: number; expenseId?: string }[];
        total: number;
      };
      expect(planRows.total).toBe(2);
      expect(planRows.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'active', amount: 2000 }),
          expect.objectContaining({
            status: 'closed',
            amount: 1000,
            expenseId: expect.any(String) as string,
          }),
        ]),
      );
      const closed = planRows.items.find((plan) => plan.status === 'closed')!;
      const expense = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${result.family.id}/expenses/${closed.expenseId}`)
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      expect(expense.body).toMatchObject({
        amount: 1200,
        participantId: maria.id,
        origin: { type: 'plan' },
      });
      const limits = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(
          `/api/v1/groups/${result.family.id}/expense-limits?periodDate=2024-03-15`,
        )
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      expect(limits.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ total: 50000, rest: 40349.5 }),
        ]),
      );
      const reserveResponse = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${result.family.id}/accounts?type=saving`)
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      const reserves = reserveResponse.body as {
        _id: string;
        name: string;
        type: string;
        amount: number;
      }[];
      expect(reserves).toHaveLength(1);
      expect(reserves[0]).toMatchObject({
        name: 'Family reserve',
        type: 'saving',
        amount: 51000,
      });
      await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/api/v1/groups/${result.family.id}/accounts/${reserves[0]._id}`)
        .auth(member.token, { type: 'bearer' })
        .expect(200)
        .expect(({ body }: { body: { amount: number } }) =>
          expect(body.amount).toBe(51000),
        );
      const response = await request(
        fixture.app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(
          `/api/v1/groups/${result.family.id}/reports/months?fromDate=2024-03-01&toDate=2024-03-31`,
        )
        .auth(member.token, { type: 'bearer' })
        .expect(200);
      const rows = response.body as PeriodReport[];
      expect(rows[0].currencies).toMatchObject([
        {
          currency: 'USD',
          incomes: 181200,
          expenses: 28450.5,
          balance: 291749.5,
          saving: 51000,
          transfersIn: 1000,
          transfersOut: 1000,
        },
      ]);
      expect(rows[0].currencies[0].expensesByCategory).toEqual(
        expect.arrayContaining([
          { categoryId: result.family.categories['Продукты'], total: 9650.5 },
          { categoryId: result.family.categories['Дом'], total: 15600 },
          { categoryId: result.family.categories['Досуг'], total: 3200 },
        ]),
      );
    }

    const transfer = await fixture.connection
      .collection('transactions')
      .findOne({
        ownerType: 'group',
        ownerId: new Types.ObjectId(result.family.id),
        type: 'transfer',
      });
    const reserve = await fixture.connection.collection('accounts').findOne({
      ownerType: 'group',
      ownerId: new Types.ObjectId(result.family.id),
      name: 'Family reserve',
    });
    expect(transfer).toMatchObject({
      ownerType: 'group',
      ownerId: new Types.ObjectId(result.family.id),
      type: 'transfer',
      createdBy: new Types.ObjectId(alex.id),
      description: 'Пополнение семейного резерва',
      transactionDate: new Date('2024-03-18T00:00:00.000Z'),
      source: {
        accountId: new Types.ObjectId(result.family.accountId),
        amount: 1000,
        currency: 'USD',
        snapshotId: expect.any(Types.ObjectId) as Types.ObjectId,
      },
      destination: {
        accountId: reserve!._id,
        amount: 1000,
        currency: 'USD',
        snapshotId: expect.any(Types.ObjectId) as Types.ObjectId,
      },
    });
    expect(transfer).not.toHaveProperty('participantId');
    expect(transfer).not.toHaveProperty('currency');
    expect(transfer).not.toHaveProperty('amount');
    for (const side of [transfer!.source, transfer!.destination] as {
      snapshotId: Types.ObjectId;
      accountId: Types.ObjectId;
    }[]) {
      expect(
        await fixture.connection.collection('accountsnapshots').findOne({
          _id: side.snapshotId,
        }),
      ).toMatchObject({ accountId: side.accountId });
    }
    await request(fixture.app.getHttpServer() as Parameters<typeof request>[0])
      .get(
        `/api/v1/groups/${result.family.id}/accounts/${result.family.accountId}`,
      )
      .auth(alex.token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: { amount: number } }) =>
        expect(body.amount).toBe(271749.5),
      );

    const attributedExpense = await fixture.connection
      .collection('transactions')
      .findOne({
        ownerId: new Types.ObjectId(result.family.id),
        description: 'Покупки за Марию',
        createdBy: new Types.ObjectId(alex.id),
        participantId: new Types.ObjectId(maria.id),
      });
    expect(attributedExpense?.description).toBe('Покупки за Марию');

    const formerMember = await fixture.connection
      .collection('groupmemberships')
      .findOne({
        groupId: new Types.ObjectId(result.family.id),
        userId: new Types.ObjectId(elena.id),
      });
    expect(formerMember).toMatchObject({
      status: 'left',
      permissions: {
        manageAccounts: false,
        manageCategories: false,
        manageLimits: false,
      },
    });

    const mariaMembership = await fixture.connection
      .collection('groupmemberships')
      .findOne({
        groupId: new Types.ObjectId(result.family.id),
        userId: new Types.ObjectId(maria.id),
      });
    expect(mariaMembership?.permissions).toEqual({
      manageAccounts: true,
      manageCategories: true,
      manageLimits: true,
      manageTransactions: false,
    });
    expect(
      await fixture.connection.collection('groupinvitations').countDocuments({
        groupId: new Types.ObjectId(result.sandbox.id),
        status: 'pending',
      }),
    ).toBe(1);
    expect(result.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
