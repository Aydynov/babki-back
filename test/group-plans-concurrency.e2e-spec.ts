import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { GroupsAccessService } from '../src/modules/groups/groups-access.service';
import { ExpensesService } from '../src/modules/transactions/expenses/expenses.service';
import { GroupFinancialActorsService } from '../src/modules/group-finances/group-financial-actors.service';
import { Plan, PlanDocument } from '../src/modules/plans/schemas/plan.schema';
import { startGroupsTestApp } from './helpers/groups-test-app';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// This timeout only detects a broken rendezvous; ordering uses real group writes.
async function rendezvous(promise: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(
          () => reject(new Error('Group barrier not reached')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('Group plan concurrency (real replica set)', () => {
  let harness: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let groupId: string;
  let accountId: string;
  let categoryId: string;
  const oid = (id: string) => new Types.ObjectId(id);
  const collection = (name: string) => harness.connection.collection(name);
  const base = () => `/groups/${groupId}`;
  const budget = () => ({ ownerType: 'group' as const, ownerId: oid(groupId) });
  const idOf = (r: Response) => {
    const b = r.body as { id?: string; _id?: string };
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
    api('post', `${base()}/plans`, user, {
      categoryId,
      amount: 10,
      currency: 'USD',
      description: 'Groceries',
      targetDate: '2026-02-15T12:00:00Z',
    });
  const close = (id: string, user = 0) =>
    api('post', `${base()}/plans/${id}/close`, user, {
      accountId,
      closingDate: '2026-02-15T12:00:00Z',
    });
  const grant = (enabled: boolean) =>
    api('patch', `${base()}/members/${harness.users[1].id}/permissions`, 0, {
      manageTransactions: enabled,
    });
  async function state() {
    const result: Record<string, unknown> = {};
    for (const name of [
      'plans',
      'transactions',
      'accounts',
      'expensecategories',
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
    result.group = await collection('groups').findOne({ _id: oid(groupId) });
    return result;
  }
  async function effects(id: string, closed: boolean, amount = 10) {
    const plan = await collection('plans').findOne({ _id: oid(id) });
    const expenses = await collection('transactions')
      .find({ ...budget(), 'origin.type': 'plan', 'origin.id': oid(id) })
      .toArray();
    expect(expenses).toHaveLength(closed ? 1 : 0);
    if (closed) {
      expect(plan).toMatchObject({
        status: 'closed',
        amount,
        expenseId: expenses[0]._id,
        closedAt: expect.any(Date) as unknown,
      });
      expect(expenses[0]).toMatchObject({
        amount,
        origin: { type: 'plan', id: oid(id) },
      });
    } else if (plan) expect(plan.status).toBe('active');
    const rows = await collection('accountsnapshots')
      .find({ accountId: oid(accountId) })
      .toArray();
    for (const row of rows)
      expect(row.amount).toBe(
        closed && row.date >= new Date('2026-02-01') ? -amount : 0,
      );
    expect(
      await collection('transactions').countDocuments({
        userId: oid(harness.users[0].id),
        'origin.id': oid(id),
      }),
    ).toBe(0);
  }
  beforeAll(async () => {
    harness = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await harness?.close();
  }, 30000);
  afterEach(() => jest.restoreAllMocks());
  beforeEach(async () => {
    await collection('groupinvitationratelimits').deleteMany({});
    groupId = idOf(
      await api('post', '/groups', 0, {
        name: 'Plan races',
        type: 'family',
      }).expect(201),
    );
    for (const user of [1, 2]) {
      const invitation = await api('post', `${base()}/invitations`).expect(201);
      await api('post', '/group-invitations/accept', user, {
        token: (invitation.body as { token: string }).token,
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
    categoryId = idOf(
      await api('post', `${base()}/expense-categories`, 0, {
        name: 'Food',
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
    const access = harness.app.get(GroupsAccessService);
    const serialize = access.serializeMutation.bind(
      access,
    ) as GroupsAccessService['serializeMutation'];
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
  it('exposes group plan creation without a financial fact', async () => {
    const id = idOf(await create().expect(201));
    await effects(id, false);
  });
  it.each([0, 1])(
    'serializes close/close with actor %s first and creates one fact',
    async (actor) => {
      await grant(true).expect(200);
      const id = idOf(await create().expect(201));
      const responses = await race(
        () => close(id, actor),
        () => close(id, actor === 0 ? 1 : 0),
      );
      expect(responses.map((r) => r.status)).toEqual([201, 400]);
      await effects(id, true);
      const expense = await collection('transactions').findOne({
        ...budget(),
        'origin.id': oid(id),
      });
      expect(String(expense?.createdBy)).toBe(harness.users[actor].id);
      await close(id).expect(400);
      await effects(id, true);
    },
  );
  it.each(
    (['patch', 'archive', 'delete'] as const).flatMap((operation) =>
      [true, false].map((closeFirst) => ({ operation, closeFirst })),
    ),
  )(
    'serializes close/$operation (close first: $closeFirst)',
    async ({ operation, closeFirst }) => {
      const id = idOf(await create().expect(201));
      const change = () =>
        operation === 'patch'
          ? api('patch', `${base()}/plans/${id}`, 0, { amount: 25 })
          : operation === 'archive'
            ? api('post', `${base()}/plans/${id}/archive`)
            : api('delete', `${base()}/plans/${id}`);
      const responses = await race(
        closeFirst ? () => close(id) : change,
        closeFirst ? change : () => close(id),
      );
      expect(responses.map((r) => r.status)).toEqual(
        closeFirst
          ? [
              201,
              operation === 'patch' ? 400 : operation === 'archive' ? 204 : 409,
            ]
          : [
              operation === 'patch' ? 200 : 204,
              operation === 'patch' ? 201 : 404,
            ],
      );
      await effects(
        id,
        closeFirst || operation === 'patch',
        !closeFirst && operation === 'patch' ? 25 : 10,
      );
    },
  );
  it.each(
    (
      [
        'account-archive',
        'account-delete',
        'category-archive',
        'category-delete',
      ] as const
    ).flatMap((operation) =>
      [true, false].map((transitionFirst) => ({ operation, transitionFirst })),
    ),
  )(
    'serializes $operation against close (transition first: $transitionFirst)',
    async ({ operation, transitionFirst }) => {
      const id = idOf(await create().expect(201));
      const transition = () =>
        operation === 'account-archive'
          ? api('post', `${base()}/accounts/${accountId}/archive`)
          : operation === 'account-delete'
            ? api('delete', `${base()}/accounts/${accountId}`)
            : operation === 'category-archive'
              ? api('patch', `${base()}/expense-categories/${categoryId}`, 0, {
                  isArchived: true,
                })
              : api('delete', `${base()}/expense-categories/${categoryId}`);
      const responses = await race(
        transitionFirst ? transition : () => close(id),
        transitionFirst ? () => close(id) : transition,
      );
      const transitionStatus =
        operation === 'category-delete' ||
        (!transitionFirst && operation === 'account-delete')
          ? 409
          : operation === 'category-archive'
            ? 200
            : 204;
      const blocked = transitionFirst && operation !== 'category-delete';
      const closeStatus = blocked
        ? operation === 'category-archive'
          ? 409
          : 404
        : 201;
      expect(responses.map((r) => r.status)).toEqual(
        transitionFirst
          ? [transitionStatus, closeStatus]
          : [closeStatus, transitionStatus],
      );
      await effects(id, !blocked);
      expect(
        await collection('expensecategories').findOne({ _id: oid(categoryId) }),
      ).not.toBeNull();
    },
  );
  it.each(
    (['create', 'patch'] as const).flatMap((assignment) =>
      (['archive', 'delete'] as const).flatMap((transition) =>
        [true, false].map((assignmentFirst) => ({
          assignment,
          transition,
          assignmentFirst,
        })),
      ),
    ),
  )(
    'serializes plan $assignment/category $transition (assignment first: $assignmentFirst)',
    async ({ assignment, transition, assignmentFirst }) => {
      const nextCategoryId = idOf(
        await api('post', `${base()}/expense-categories`, 0, {
          name: 'Next category',
        }).expect(201),
      );
      const existingId =
        assignment === 'patch' ? idOf(await create().expect(201)) : undefined;
      const before = existingId
        ? await collection('plans').findOne({ _id: oid(existingId) })
        : null;
      const assign = () =>
        existingId
          ? api('patch', `${base()}/plans/${existingId}`, 0, {
              categoryId: nextCategoryId,
              amount: 25,
            })
          : api('post', `${base()}/plans`, 2, {
              categoryId: nextCategoryId,
              amount: 25,
              currency: 'USD',
              description: 'New category race',
              targetDate: '2026-02-15T12:00:00Z',
            });
      const changeCategory = () =>
        transition === 'archive'
          ? api('patch', `${base()}/expense-categories/${nextCategoryId}`, 0, {
              isArchived: true,
            })
          : api('delete', `${base()}/expense-categories/${nextCategoryId}`);
      const responses = await race(
        assignmentFirst ? assign : changeCategory,
        assignmentFirst ? changeCategory : assign,
      );
      const assignmentStatus = assignmentFirst
        ? assignment === 'create'
          ? 201
          : 200
        : transition === 'archive'
          ? 409
          : 404;
      const transitionStatus =
        transition === 'archive' ? 200 : assignmentFirst ? 409 : 204;
      expect(responses.map((response) => response.status)).toEqual(
        assignmentFirst
          ? [assignmentStatus, transitionStatus]
          : [transitionStatus, assignmentStatus],
      );
      const plans = await collection('plans').find(budget()).toArray();
      expect(plans).toHaveLength(assignmentFirst || existingId ? 1 : 0);
      if (assignmentFirst) {
        expect(plans[0]).toMatchObject({
          categoryId: oid(nextCategoryId),
          amount: 25,
          status: 'active',
        });
      } else if (existingId) {
        expect(plans[0]).toEqual(before);
        expect(plans[0].categoryId).toEqual(oid(categoryId));
      }
      const nextCategory = await collection('expensecategories').findOne({
        _id: oid(nextCategoryId),
        ...budget(),
      });
      if (transition === 'delete' && !assignmentFirst) {
        expect(nextCategory).toBeNull();
      } else {
        expect(nextCategory).not.toBeNull();
        expect(nextCategory?.isArchived).toBe(transition === 'archive');
      }
      for (const plan of plans) {
        expect(
          await collection('expensecategories').findOne({
            _id: plan.categoryId as Types.ObjectId,
            ...budget(),
          }),
        ).not.toBeNull();
        await effects(String(plan._id), false);
      }
      expect(await collection('transactions').countDocuments(budget())).toBe(0);
      for (const row of await collection('accountsnapshots')
        .find({ accountId: oid(accountId) })
        .toArray()) {
        expect(row.amount).toBe(0);
      }
    },
  );
  it.each(
    (['revoke', 'remove', 'ownership', 'group-delete'] as const).flatMap(
      (action) =>
        [true, false].map((transitionFirst) => ({ action, transitionFirst })),
    ),
  )(
    'serializes $action against close (transition first: $transitionFirst)',
    async ({ action, transitionFirst }) => {
      const id = idOf(await create().expect(201));
      await grant(true).expect(200);
      const actor = action === 'ownership' ? 0 : 1;
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
        transitionFirst ? transition : () => close(id, actor),
        transitionFirst ? () => close(id, actor) : transition,
      );
      const transitionStatus =
        action === 'remove' || action === 'group-delete' ? 204 : 200;
      const denied =
        action === 'remove' || action === 'group-delete' ? 404 : 403;
      expect(responses.map((r) => r.status)).toEqual(
        transitionFirst ? [transitionStatus, denied] : [201, transitionStatus],
      );
      await effects(id, !transitionFirst);
    },
  );
  it.each(['expense', 'plan-update', 'actor'] as const)(
    'rolls back close after completed %s writes/lookup',
    async (phase) => {
      const id = idOf(await create().expect(201));
      const before = await state();
      let injected = false;
      let restore: () => void;
      if (phase === 'expense') {
        const service = harness.app.get(ExpensesService);
        const original = service.createForBudget.bind(
          service,
        ) as ExpensesService['createForBudget'];
        const spy = jest
          .spyOn(service, 'createForBudget')
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            await original(...args);
            injected = true;
            throw new Error('Injected after expense creation');
          });
        restore = () => spy.mockRestore();
      } else if (phase === 'plan-update') {
        const model = harness.app.get<Model<PlanDocument>>(
          getModelToken(Plan.name),
        );
        const original = model.findOneAndUpdate.bind(
          model,
        ) as Model<PlanDocument>['findOneAndUpdate'];
        const spy = jest
          .spyOn(model, 'findOneAndUpdate')
          .mockImplementation((...args: Parameters<typeof original>) => {
            const query = original(...args);
            const exec = query.exec.bind(query) as () => Promise<unknown>;
            jest.spyOn(query, 'exec').mockImplementation(async () => {
              await exec();
              injected = true;
              throw new Error('Injected after plan CAS update');
            });
            return query;
          });
        restore = () => spy.mockRestore();
      } else {
        const service = harness.app.get(GroupFinancialActorsService);
        const original = service.enrichOne.bind(
          service,
        ) as GroupFinancialActorsService['enrichOne'];
        const spy = jest
          .spyOn(service, 'enrichOne')
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            await original(...args);
            injected = true;
            throw new Error('Injected after actor lookup');
          });
        restore = () => spy.mockRestore();
      }
      try {
        await close(id).expect(503);
      } finally {
        restore();
      }
      expect(injected).toBe(true);
      expect(await state()).toEqual(before);
      await effects(id, false);
      await close(id).expect(201);
      await effects(id, true);
    },
  );
  it('preserves personal concurrent-close CAS and snapshot carry with one expense', async () => {
    const personalAccount = idOf(
      await api('post', '/accounts', 0, {
        name: 'Personal race',
        type: 'balance',
        currency: 'USD',
        amount: 0,
        openedAt: '2026-01-01T00:00:00Z',
      }).expect(201),
    );
    const personalCategory = idOf(
      await api('post', '/expense-categories', 0, {
        name: 'Personal race',
      }).expect(201),
    );
    const id = idOf(
      await api('post', '/plans', 0, {
        categoryId: personalCategory,
        amount: 10,
        currency: 'USD',
        description: 'Personal race',
        targetDate: '2026-02-15',
      }).expect(201),
    );
    await collection('accountsnapshots').insertOne({
      accountId: oid(personalAccount),
      date: new Date('2026-04-30T23:59:59.999Z'),
      amount: 0,
    });
    const service = harness.app.get(ExpensesService);
    const original = service.createForBudget.bind(
      service,
    ) as ExpensesService['createForBudget'];
    const entered = signal();
    const release = signal();
    let calls = 0;
    const spy = jest
      .spyOn(service, 'createForBudget')
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        if (args[0].ownerType === 'user' && ++calls <= 2) {
          if (calls === 2) entered.resolve();
          await release.promise;
        }
        return original(...args);
      });
    const execute = () =>
      Promise.resolve(
        api('post', `/plans/${id}/close`, 0, {
          accountId: personalAccount,
          closingDate: '2026-02-15T12:00:00Z',
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
    const expenses = await collection('transactions')
      .find({ 'origin.id': oid(id), 'origin.type': 'plan' })
      .toArray();
    expect(expenses).toHaveLength(1);
    expect(await collection('plans').findOne({ _id: oid(id) })).toMatchObject({
      status: 'closed',
      amount: 10,
      expenseId: expenses[0]._id,
    });
    for (const row of await collection('accountsnapshots')
      .find({ accountId: oid(personalAccount) })
      .toArray()) {
      // Personal snapshots retain the existing local start-of-month boundary.
      expect(row.amount).toBe(row.date >= new Date(2026, 1, 1) ? -10 : 0);
    }
    await api('post', `/plans/${id}/close`, 0, {
      accountId: personalAccount,
    }).expect(400);
    expect(
      await collection('transactions').countDocuments({ 'origin.id': oid(id) }),
    ).toBe(1);
  });
});
