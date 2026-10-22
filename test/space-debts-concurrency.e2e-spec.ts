import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { SpacesAccessService } from '../src/modules/spaces/spaces-access.service';
import { IncomesService } from '../src/modules/transactions/incomes/incomes.service';
import { TransactionsService } from '../src/modules/transactions/transactions/transactions.service';
import { SpaceFinancialActorsService } from '../src/modules/space-finances/space-financial-actors.service';
import { Debt, DebtDocument } from '../src/modules/debts/schemas/debt.schema';
import {
  DebtTransaction,
  DebtTransactionDocument,
} from '../src/modules/debt-transactions/schemas/debt-transaction.schema';
import { startSpacesTestApp } from './helpers/spaces-test-app';
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// This timeout only detects a broken rendezvous; ordering uses real space writes.
async function rendezvous(promise: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(
          () => reject(new Error('Space barrier not reached')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
describe('Space debt concurrency (real replica set)', () => {
  let harness: Awaited<ReturnType<typeof startSpacesTestApp>>;
  let spaceId: string;
  let accountId: string;
  const oid = (id: string) => new Types.ObjectId(id);
  const collection = (name: string) => harness.connection.collection(name);
  const base = () => `/spaces/${spaceId}`;
  const budget = () => ({ spaceId: oid(spaceId) });
  const idOf = (r: Response) => {
    const b = r.body as {
      id?: string;
      _id?: string;
    };
    return (b.id ?? b._id)!;
  };
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
    body: object = {},
  ) {
    return request(harness.app.getHttpServer() as Parameters<typeof request>[0])
      [method](`/api/v1${path}`)
      .auth(harness.users[user].token, { type: 'bearer' })
      .send(body);
  }
  const create = (user = 2) =>
    api('post', `${base()}/debts`, user, {
      debtor: 'Debtor',
      principalAmount: 100,
      currency: 'USD',
    });
  const repay = (id: string, user = 0, amount = 60) =>
    api('post', `${base()}/debts/${id}/repayments`, user, {
      amount,
      isIncome: true,
      accountId,
      repaymentDate: '2026-02-15T12:00:00Z',
    });
  const cancel = (id: string, repaymentId: string, user = 0) =>
    api('post', `${base()}/debts/${id}/repayments/${repaymentId}/cancel`, user);
  const repaymentId = (r: Response) =>
    (
      r.body as {
        repayment: {
          _id: string;
        };
      }
    ).repayment._id;
  const grant = (enabled: boolean) =>
    api('patch', `${base()}/members/${harness.users[1].id}/permissions`, 0, {
      manageTransactions: enabled,
    });
  async function state() {
    const result: Record<string, unknown> = {};
    for (const name of [
      'debts',
      'debttransactions',
      'transactions',
      'accounts',
    ]) {
      result[name] = await collection(name)
        .find(budget())
        .sort({ _id: 1 })
        .toArray();
    }
    result.snapshots = await collection('accountsnapshots')
      .find({ accountId: oid(accountId) })
      .sort({ date: 1 })
      .toArray();
    result.space = await collection('spaces').findOne({ _id: oid(spaceId) });
    return result;
  }
  async function effects(
    id: string,
    remaining: number,
    total: number,
    cancelled = 0,
  ) {
    const debt = await collection('debts').findOne({ _id: oid(id) });
    const history = await collection('debttransactions')
      .find({ debtId: oid(id) })
      .toArray();
    const incomes = await collection('transactions')
      .find({ ...budget(), 'origin.type': 'debt', 'origin.id': oid(id) })
      .toArray();
    expect(history).toHaveLength(total);
    expect(history.filter((row) => row.cancelledAt != null)).toHaveLength(
      cancelled,
    );
    const active = history.filter((row) => row.cancelledAt == null);
    if (debt) {
      expect(debt.remainingAmount).toBe(remaining);
      expect(debt.status).toBe(remaining === 0 ? 'closed' : 'active');
      expect(debt.remainingAmount).toBe(
        debt.principalAmount -
          active.reduce((sum, row) => sum + Number(row.amount), 0),
      );
    }
    expect(incomes).toHaveLength(history.filter((row) => row.isIncome).length);
    for (const row of history) {
      expect(String(row.spaceId)).toBe(spaceId);
      expect(row.userId).toBeUndefined();
      if (row.isIncome) {
        const income = incomes.find(
          (income) => String(income._id) === String(row.incomeId),
        );
        expect(income).toMatchObject({
          amount: row.amount as number,
          transactionDate: row.transactionDate as Date,
        });
        expect(income?.deletedAt != null).toBe(row.cancelledAt != null);
      }
    }
    const cash = active
      .filter((row) => row.isIncome)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    for (const row of await collection('accountsnapshots')
      .find({ accountId: oid(accountId) })
      .toArray())
      expect(row.amount).toBe(row.date >= new Date('2026-02-01') ? cash : 0);
    expect(
      await collection('transactions').countDocuments({
        userId: oid(harness.users[0].id),
        'origin.id': oid(id),
      }),
    ).toBe(0);
  }
  beforeAll(async () => {
    harness = await startSpacesTestApp();
  }, 60000);
  afterAll(async () => {
    await harness?.close();
  }, 30000);
  afterEach(() => jest.restoreAllMocks());
  beforeEach(async () => {
    await collection('spaceinvitationratelimits').deleteMany({});
    spaceId = idOf(
      await api('post', '/spaces', 0, {
        name: 'Plan races',
      }).expect(201),
    );
    for (const user of [1, 2]) {
      const invitation = await api('post', `${base()}/invitations`).expect(201);
      await api('post', '/space-invitations/accept', user, {
        token: (
          invitation.body as {
            token: string;
          }
        ).token,
      }).expect(200);
    }
    accountId = idOf(
      await api('post', `${base()}/accounts`, 0, {
        name: 'Family',
        currency: 'USD',
        amount: 0,
        openedAt: '2026-01-01T00:00:00Z',
      }).expect(201),
    );
    await collection('accountsnapshots').insertOne({
      accountId: oid(accountId),
      date: new Date('2026-04-30T23:59:59.999Z'),
      amount: 0,
    });
  });
  async function race(
    first: () => PromiseLike<Response>,
    second: () => PromiseLike<Response>,
  ) {
    const access = harness.app.get(SpacesAccessService);
    const serialize = access.serializeMutation.bind(
      access,
    ) as SpacesAccessService['serializeMutation'];
    const locked = signal();
    const contender = signal();
    const release = signal();
    let calls = 0;
    const spy = jest
      .spyOn(access, 'serializeMutation')
      .mockImplementation(async (...args: Parameters<typeof serialize>) => {
        const initial = ++calls === 1;
        if (!initial) contender.resolve();
        const result = await serialize(...args);
        if (initial) {
          locked.resolve();
          await release.promise;
        }
        return result;
      });
    const firstResponse = Promise.resolve(first());
    let secondResponse: Promise<Response> | undefined;
    try {
      await rendezvous(locked.promise);
      secondResponse = Promise.resolve(second());
      await rendezvous(contender.promise);
      release.resolve();
      return await Promise.all([firstResponse, secondResponse]);
    } finally {
      release.resolve();
      await Promise.allSettled([
        firstResponse,
        ...(secondResponse ? [secondResponse] : []),
      ]);
      spy.mockRestore();
    }
  }
  it('exposes space debt creation without a financial fact', async () => {
    const id = idOf(await create().expect(201));
    await effects(id, 100, 0);
  });
  it.each([0, 1])(
    'serializes two 60 repayments of remaining 100 (actor %s first)',
    async (actor) => {
      await grant(true).expect(200);
      const id = idOf(await create().expect(201));
      const responses = await race(
        () => repay(id, actor),
        () => repay(id, actor === 0 ? 1 : 0),
      );
      expect(responses.map((r) => r.status)).toEqual([201, 400]);
      await effects(id, 40, 1);
      expect(
        String(
          (await collection('debttransactions').findOne({ debtId: oid(id) }))
            ?.createdBy,
        ),
      ).toBe(harness.users[actor].id);
    },
  );
  it('serializes cancel/cancel with exactly one financial compensation', async () => {
    const id = idOf(await create().expect(201));
    const historyId = repaymentId(await repay(id).expect(201));
    const responses = await race(
      () => cancel(id, historyId),
      () => cancel(id, historyId),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 409]);
    await effects(id, 100, 1, 1);
  });
  it.each([true, false])(
    'serializes repay/cancel (repay first: %s)',
    async (repayFirst) => {
      const id = idOf(await create().expect(201));
      const historyId = repaymentId(await repay(id).expect(201));
      const responses = await race(
        repayFirst ? () => repay(id) : () => cancel(id, historyId),
        repayFirst ? () => cancel(id, historyId) : () => repay(id),
      );
      expect(responses.map((r) => r.status)).toEqual(
        repayFirst ? [400, 200] : [200, 201],
      );
      await effects(id, repayFirst ? 100 : 40, repayFirst ? 1 : 2, 1);
    },
  );
  it.each([true, false])(
    'serializes principal PATCH/first history (patch first: %s)',
    async (patchFirst) => {
      const id = idOf(await create().expect(201));
      const patch = () =>
        api('patch', `${base()}/debts/${id}`, 0, { principalAmount: 200 });
      const responses = await race(
        patchFirst ? patch : () => repay(id),
        patchFirst ? () => repay(id) : patch,
      );
      expect(responses.map((r) => r.status)).toEqual(
        patchFirst ? [200, 201] : [201, 409],
      );
      await effects(id, patchFirst ? 140 : 40, 1);
    },
  );
  it.each(
    (['metadata', 'archive', 'delete'] as const).flatMap((operation) =>
      (['repay', 'cancel'] as const).flatMap((mutation) =>
        [true, false].map((transitionFirst) => ({
          operation,
          mutation,
          transitionFirst,
        })),
      ),
    ),
  )(
    'serializes $operation/$mutation (transition first: $transitionFirst)',
    async ({ operation, mutation, transitionFirst }) => {
      const id = idOf(await create().expect(201));
      const historyId =
        mutation === 'cancel' ? repaymentId(await repay(id).expect(201)) : '';
      const execute = () =>
        mutation === 'repay' ? repay(id) : cancel(id, historyId);
      const transition = () =>
        operation === 'metadata'
          ? api('patch', `${base()}/debts/${id}`, 0, { debtor: 'Renamed' })
          : operation === 'archive'
            ? api('post', `${base()}/debts/${id}/archive`)
            : api('delete', `${base()}/debts/${id}`);
      const responses = await race(
        transitionFirst ? transition : execute,
        transitionFirst ? execute : transition,
      );
      const transitionStatus =
        operation === 'metadata'
          ? 200
          : operation === 'delete' &&
              (mutation === 'cancel' || !transitionFirst)
            ? 409
            : 204;
      const mutationStatus =
        transitionFirst && operation !== 'metadata' && transitionStatus === 204
          ? 404
          : mutation === 'repay'
            ? 201
            : 200;
      expect(responses.map((r) => r.status)).toEqual(
        transitionFirst
          ? [transitionStatus, mutationStatus]
          : [mutationStatus, transitionStatus],
      );
      const completed = mutationStatus !== 404;
      await effects(
        id,
        mutation === 'repay' ? (completed ? 40 : 100) : completed ? 100 : 40,
        mutation === 'repay' ? Number(completed) : 1,
        mutation === 'cancel' ? Number(completed) : 0,
      );
    },
  );
  it.each(
    (['archive', 'delete'] as const).flatMap((operation) =>
      (['repay', 'cancel'] as const).flatMap((mutation) =>
        [true, false].map((transitionFirst) => ({
          operation,
          mutation,
          transitionFirst,
        })),
      ),
    ),
  )(
    'serializes account $operation/$mutation (transition first: $transitionFirst)',
    async ({ operation, mutation, transitionFirst }) => {
      const id = idOf(await create().expect(201));
      const historyId =
        mutation === 'cancel' ? repaymentId(await repay(id).expect(201)) : '';
      const execute = () =>
        mutation === 'repay' ? repay(id) : cancel(id, historyId);
      const transition = () =>
        operation === 'archive'
          ? api('post', `${base()}/accounts/${accountId}/archive`)
          : api('delete', `${base()}/accounts/${accountId}`);
      const responses = await race(
        transitionFirst ? transition : execute,
        transitionFirst ? execute : transition,
      );
      const transitionStatus =
        operation === 'delete' && (mutation === 'cancel' || !transitionFirst)
          ? 409
          : 204;
      const completed = !transitionFirst || transitionStatus === 409;
      const mutationStatus = completed
        ? mutation === 'repay'
          ? 201
          : 200
        : 404;
      expect(responses.map((r) => r.status)).toEqual(
        transitionFirst
          ? [transitionStatus, mutationStatus]
          : [mutationStatus, transitionStatus],
      );
      await effects(
        id,
        mutation === 'repay' ? (completed ? 40 : 100) : completed ? 100 : 40,
        mutation === 'repay' ? Number(completed) : 1,
        mutation === 'cancel' ? Number(completed) : 0,
      );
    },
  );
  it.each(
    (['revoke', 'remove', 'ownership', 'space-delete'] as const).flatMap(
      (action) =>
        (['repay', 'cancel'] as const).flatMap((mutation) =>
          [true, false].map((transitionFirst) => ({
            action,
            mutation,
            transitionFirst,
          })),
        ),
    ),
  )(
    'serializes $action/$mutation (transition first: $transitionFirst)',
    async ({ action, mutation, transitionFirst }) => {
      const id = idOf(await create().expect(201));
      await grant(true).expect(200);
      const actor = action === 'ownership' ? 0 : 1;
      const historyId =
        mutation === 'cancel' ? repaymentId(await repay(id).expect(201)) : '';
      const execute = () =>
        mutation === 'repay' ? repay(id, actor) : cancel(id, historyId, actor);
      const transition = () =>
        action === 'revoke'
          ? grant(false)
          : action === 'remove'
            ? api('delete', `${base()}/members/${harness.users[1].id}`)
            : action === 'ownership'
              ? api('post', `${base()}/ownership`, 0, {
                  userId: harness.users[1].id,
                })
              : api('delete', base());
      const responses = await race(
        transitionFirst ? transition : execute,
        transitionFirst ? execute : transition,
      );
      const transitionStatus =
        action === 'remove' || action === 'space-delete' ? 204 : 200;
      const mutationStatus = transitionFirst
        ? action === 'remove' || action === 'space-delete'
          ? 404
          : 403
        : mutation === 'repay'
          ? 201
          : 200;
      expect(responses.map((r) => r.status)).toEqual(
        transitionFirst
          ? [transitionStatus, mutationStatus]
          : [mutationStatus, transitionStatus],
      );
      await effects(
        id,
        mutation === 'repay'
          ? transitionFirst
            ? 100
            : 40
          : transitionFirst
            ? 40
            : 100,
        mutation === 'repay' ? Number(!transitionFirst) : 1,
        mutation === 'cancel' ? Number(!transitionFirst) : 0,
      );
    },
  );
  it.each(
    (['repay', 'cancel'] as const).flatMap((mutation) =>
      ['income', 'history', 'debt', 'actor'].map((phase) => ({
        mutation,
        phase,
      })),
    ),
  )(
    'rolls back $mutation after completed $phase writes/lookup',
    async ({ mutation, phase }) => {
      const id = idOf(await create().expect(201));
      const historyId =
        mutation === 'cancel' ? repaymentId(await repay(id).expect(201)) : '';
      const before = await state();
      let injected = false;
      const fail = () => {
        injected = true;
        throw new Error(`Injected ${mutation}/${phase}`);
      };
      let restore: () => void;
      if (phase === 'income' && mutation === 'repay') {
        const service = harness.app.get(IncomesService);
        const original = service.createForBudget.bind(
          service,
        ) as IncomesService['createForBudget'];
        const spy = jest
          .spyOn(service, 'createForBudget')
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            await original(...args);
            return fail();
          });
        restore = () => spy.mockRestore();
      } else if (phase === 'income') {
        const service = harness.app.get(TransactionsService);
        const original = service.deleteForBudget.bind(
          service,
        ) as TransactionsService['deleteForBudget'];
        const spy = jest
          .spyOn(service, 'deleteForBudget')
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            await original(...args);
            return fail();
          });
        restore = () => spy.mockRestore();
      } else if (phase === 'history' && mutation === 'repay') {
        const model = harness.app.get<Model<DebtTransactionDocument>>(
          getModelToken(DebtTransaction.name),
        );
        const original = model.create.bind(
          model,
        ) as Model<DebtTransactionDocument>['create'];
        const spy = jest
          .spyOn(model, 'create')
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            await original(...args);
            return fail();
          });
        restore = () => spy.mockRestore();
      } else if (phase === 'history' || phase === 'debt') {
        const model =
          phase === 'debt'
            ? harness.app.get<Model<DebtDocument>>(getModelToken(Debt.name))
            : harness.app.get<Model<DebtTransactionDocument>>(
                getModelToken(DebtTransaction.name),
              );
        // Both aggregate models expose the same query execution boundary.
        const original = model.findOneAndUpdate.bind(
          model,
        ) as Model<DebtDocument>['findOneAndUpdate'];
        const spy = jest
          .spyOn(model, 'findOneAndUpdate')
          .mockImplementation((...args: Parameters<typeof original>) => {
            const query = original(...args);
            const exec = query.exec.bind(query) as () => Promise<unknown>;
            jest.spyOn(query, 'exec').mockImplementation(async () => {
              await exec();
              return fail();
            });
            return query;
          });
        restore = () => spy.mockRestore();
      } else {
        const service = harness.app.get(SpaceFinancialActorsService);
        const original = service.enrich.bind(
          service,
        ) as SpaceFinancialActorsService['enrich'];
        const spy = jest
          .spyOn(service, 'enrich')
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            await original(...args);
            return fail();
          });
        restore = () => spy.mockRestore();
      }
      const execute = () =>
        mutation === 'repay' ? repay(id) : cancel(id, historyId);
      try {
        await execute().expect(503);
      } finally {
        restore();
      }
      expect(injected).toBe(true);
      expect(await state()).toEqual(before);
      await effects(
        id,
        mutation === 'repay' ? 100 : 40,
        mutation === 'repay' ? 0 : 1,
      );
      await execute().expect(mutation === 'repay' ? 201 : 200);
      await effects(
        id,
        mutation === 'repay' ? 40 : 100,
        1,
        mutation === 'cancel' ? 1 : 0,
      );
    },
  );
  it('preserves isolated-space remaining during concurrent 60 repayments of 100', async () => {
    const isolatedId = idOf(
      await api('post', '/spaces', 0, {
        name: 'Isolated carry-over race',
      }).expect(201),
    );
    const isolatedBase = `/spaces/${isolatedId}`;
    const isolatedAccount = idOf(
      await api('post', `${isolatedBase}/accounts`, 0, {
        name: 'Isolated debt race',
        type: 'balance',
        currency: 'USD',
        amount: 0,
        openedAt: '2026-01-01T00:00:00Z',
      }).expect(201),
    );
    const id = idOf(
      await api('post', `${isolatedBase}/debts`, 0, {
        debtor: 'Isolated debtor',
        principalAmount: 100,
        currency: 'USD',
      }).expect(201),
    );
    await collection('accountsnapshots').insertOne({
      accountId: oid(isolatedAccount),
      date: new Date('2026-04-30T23:59:59.999Z'),
      amount: 0,
    });
    const service = harness.app.get(IncomesService);
    const original = service.createForBudget.bind(
      service,
    ) as IncomesService['createForBudget'];
    const entered = signal();
    const release = signal();
    let calls = 0;
    const spy = jest
      .spyOn(service, 'createForBudget')
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        if (String(args[0].spaceId) === isolatedId && ++calls <= 2) {
          if (calls === 1) entered.resolve();
          await release.promise;
        }
        return original(...args);
      });
    const execute = () =>
      Promise.resolve(
        api('post', `${isolatedBase}/debts/${id}/repayments`, 0, {
          amount: 60,
          isIncome: true,
          accountId: isolatedAccount,
          repaymentDate: '2026-02-15T12:00:00Z',
        }),
      );
    const requests = [execute(), execute()];
    let responses: Response[];
    try {
      await rendezvous(entered.promise);
      release.resolve();
      responses = await Promise.all(requests);
    } finally {
      release.resolve();
      await Promise.allSettled(requests);
      spy.mockRestore();
    }
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await collection('debts').findOne({ _id: oid(id) })).toMatchObject({
      remainingAmount: 40,
      status: 'active',
    });
    expect(
      await collection('debttransactions').countDocuments({ debtId: oid(id) }),
    ).toBe(1);
    expect(
      await collection('transactions').countDocuments({
        'origin.type': 'debt',
        'origin.id': oid(id),
      }),
    ).toBe(1);
    for (const row of await collection('accountsnapshots')
      .find({ accountId: oid(isolatedAccount) })
      .toArray())
      expect(row.amount).toBe(
        row.date >= new Date(Date.UTC(2026, 1, 1)) ? 60 : 0,
      );
  });
});
