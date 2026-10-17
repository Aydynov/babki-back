import { Types } from 'mongoose';
import request, { Response } from 'supertest';
import { GroupsAccessService } from '../src/modules/groups/groups-access.service';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group account lifecycle', () => {
  let ctx: Awaited<ReturnType<typeof startGroupsTestApp>>;
  let groupId: string;
  let accountId: string;
  const idOf = (response: Response) => (response.body as { _id: string })._id;
  const base = () => `/groups/${groupId}`;
  const account = () => `${base()}/accounts/${accountId}`;
  function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    user = 0,
  ) {
    const call = request(
      ctx.app.getHttpServer() as Parameters<typeof request>[0],
    )[method](`/api/v1${path}`);
    return user < 0
      ? call
      : call.auth(ctx.users[user].token, { type: 'bearer' });
  }
  beforeAll(async () => {
    ctx = await startGroupsTestApp();
  }, 60000);
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await ctx.connection.collection('groupinvitationratelimits').deleteMany({});
    const response = await api('post', '/groups')
      .send({ name: 'Lifecycle', type: 'family' })
      .expect(201);
    groupId = (response.body as { id: string }).id;
    accountId = idOf(
      await api('post', `${base()}/accounts`)
        .send({
          name: 'Current',
          currency: 'USD',
          openedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201),
    );
  });

  it('renames the default balance account with a trimmed name', async () => {
    expect(
      (
        await api('patch', account())
          .send({ name: '  Daily expenses  ' })
          .expect(200)
      ).body,
    ).toMatchObject({
      _id: accountId,
      name: 'Daily expenses',
      type: 'balance',
      currency: 'USD',
      amount: 0,
      archivedAt: null,
    });
  });

  it('archives the default balance account without changing its amount', async () => {
    await api('post', `${account()}/archive`).expect(204);
    expect((await api('get', account()).expect(200)).body).toMatchObject({
      _id: accountId,
      name: 'Current',
      type: 'balance',
      currency: 'USD',
      amount: 0,
      archivedAt: expect.any(String) as unknown,
    });
  });

  async function join(user: number) {
    const invite = await api('post', `${base()}/invitations`).expect(201);
    await api('post', '/group-invitations/accept', user)
      .send({ token: (invite.body as { token: string }).token })
      .expect(200);
  }
  const grant = (enabled: boolean) =>
    api('patch', `${base()}/members/${ctx.users[1].id}/permissions`).send({
      manageAccounts: enabled,
    });
  const createIncome = (user = 0, amount = 10) =>
    api('post', `${base()}/incomes`, user).send({
      accountId,
      amount,
      transactionDate: '2026-02-15T12:00:00Z',
    });

  it('rejects invalid rename and immutable fields without changing account or snapshots', async () => {
    const before = (await api('get', account()).expect(200)).body as unknown;
    const snapshots = await ctx.connection
      .collection('accountsnapshots')
      .find({ accountId: new Types.ObjectId(accountId) })
      .toArray();
    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: null },
      { unknown: 'field' },
      { name: 'Renamed', type: 'saving' },
      { currency: 'RUB' },
      { amount: 10 },
      { initialAmount: 10 },
      { openedAt: '2026-02-01' },
      { ownerId: ctx.users[1].id },
      { archivedAt: null },
    ]) {
      await api('patch', account()).send(body).expect(400);
    }
    expect((await api('get', account()).expect(200)).body).toEqual(before);
    expect(
      await ctx.connection
        .collection('accountsnapshots')
        .find({ accountId: new Types.ObjectId(accountId) })
        .toArray(),
    ).toEqual(snapshots);
    await api('post', `${account()}/archive`)
      .send({ archivedAt: '2026-02-01' })
      .expect(400);
    await api('post', `${account()}/archive?force=true`).expect(400);
    await api('patch', account())
      .send({ name: 'x'.repeat(100) })
      .expect(200);
  });

  it('checks manageAccounts on every rename/archive with the same JWT', async () => {
    await join(1);
    for (const method of ['patch', 'post'] as const) {
      const path = method === 'patch' ? account() : `${account()}/archive`;
      const body = method === 'patch' ? { name: 'Denied' } : {};
      await api(method, path, -1).send(body).expect(401);
      await api(method, path, 1).send(body).expect(403);
    }
    await grant(true).expect(200);
    expect(
      (await api('patch', account(), 1).send({ name: 'Delegate' }).expect(200))
        .body,
    ).toMatchObject({ name: 'Delegate' });
    await grant(false).expect(200);
    await api('patch', account(), 1).send({ name: 'Revoked' }).expect(403);
    await api('post', `${account()}/archive`, 1).expect(403);
    await grant(true).expect(200);
    await api('post', `${account()}/archive`, 1).expect(204);
    await api('patch', account(), 1)
      .send({ name: 'Archived metadata' })
      .expect(200);
    await api('post', `${account()}/archive`).expect(404);
    await api('delete', `${base()}/members/${ctx.users[1].id}`).expect(204);
    await api('patch', account(), 1).send({ name: 'Removed' }).expect(404);
    await api('post', `${account()}/archive`, 1).expect(404);
  });

  it('conceals foreign and personal account identities from an authorized owner', async () => {
    const foreign = await api('post', '/groups')
      .send({ name: 'Foreign', type: 'family' })
      .expect(201);
    const foreignId = (foreign.body as { id: string }).id;
    const other = idOf(
      await api('post', `/groups/${foreignId}/accounts`)
        .send({ name: 'Other', currency: 'USD' })
        .expect(201),
    );
    const personal = idOf(
      await api('post', '/accounts')
        .send({ name: 'Personal', currency: 'USD', type: 'balance' })
        .expect(201),
    );
    for (const id of [other, personal]) {
      await api('patch', `${base()}/accounts/${id}`)
        .send({ name: 'Intrusion' })
        .expect(404);
      await api('post', `${base()}/accounts/${id}/archive`).expect(404);
    }
    expect(
      (await api('get', `/groups/${foreignId}/accounts/${other}`).expect(200))
        .body,
    ).toMatchObject({ name: 'Other', archivedAt: null });
    expect(
      (await api('get', `/accounts/${personal}`).expect(200)).body,
    ).toMatchObject({ name: 'Personal', archivedAt: null });
  });

  it.each(['balance', 'saving'] as const)(
    'freezes %s financial records while retaining history, limits and reports',
    async (type) => {
      await join(1);
      await join(2);
      if (type === 'saving')
        accountId = idOf(
          await api('post', `${base()}/accounts`)
            .send({
              name: 'Reserve',
              type,
              currency: 'USD',
              amount: 3,
              openedAt: '2026-01-01T00:00:00Z',
            })
            .expect(201),
        );
      const categoryId = idOf(
        await api('post', `${base()}/expense-categories`)
          .send({ name: 'Food' })
          .expect(201),
      );
      const limitId = idOf(
        await api('post', `${base()}/expense-limits`)
          .send({
            categoryId,
            currency: 'USD',
            total: 15,
            startDate: '2026-02-01',
            endDate: '2026-02-28',
          })
          .expect(201),
      );
      const incomeId = idOf(await createIncome(1).expect(201));
      const expenseBody = {
        accountId,
        categoryId,
        participantId: ctx.users[2].id,
        amount: 5,
        transactionDate: '2026-02-15T12:00:00Z',
      };
      const expenseId = idOf(
        await api('post', `${base()}/expenses`, 1)
          .send(expenseBody)
          .expect(201),
      );
      await api('patch', `${base()}/members/${ctx.users[2].id}/permissions`)
        .send({ manageTransactions: true })
        .expect(200);
      const filter = { accountId: new Types.ObjectId(accountId) };
      const rows = await ctx.connection
        .collection('transactions')
        .find(filter)
        .sort({ _id: 1 })
        .toArray();
      const snapshots = await ctx.connection
        .collection('accountsnapshots')
        .find(filter)
        .sort({ _id: 1 })
        .toArray();
      const reportPath = `${base()}/reports/months?fromDate=2026-02-01&toDate=2026-02-28`;
      const report = (await api('get', reportPath).expect(200)).body as unknown;
      await api('post', `${account()}/archive`).expect(204);
      const archived = (await api('get', account(), 1).expect(200)).body as {
        archivedAt: string;
      };
      expect(archived).toMatchObject({
        amount: type === 'saving' ? 8 : 5,
        type,
        currency: 'USD',
        archivedAt: expect.any(String) as unknown,
      });
      expect(
        (await api('get', `${base()}/accounts`, 1).expect(200)).body,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: accountId,
            archivedAt: archived.archivedAt,
          }),
        ]),
      );
      for (const user of [0, 1, 2]) {
        await createIncome(user).expect(404);
        await api('post', `${base()}/expenses`, user)
          .send(expenseBody)
          .expect(404);
        for (const [kind, id] of [
          ['incomes', incomeId],
          ['expenses', expenseId],
        ] as const) {
          const changes =
            kind === 'expenses'
              ? [
                  { amount: 7 },
                  { description: 'Changed' },
                  { items: [{ name: 'Item', quantity: 1, price: 7 }] },
                  { participantId: ctx.users[0].id },
                ]
              : [{ amount: 7 }, { description: 'Changed' }];
          for (const body of changes)
            await api('patch', `${base()}/${kind}/${id}`, user)
              .send(body)
              .expect(404);
          await api('delete', `${base()}/${kind}/${id}`, user).expect(404);
          expect(
            (await api('get', `${base()}/${kind}/${id}`, user).expect(200))
              .body,
          ).toMatchObject({
            _id: id,
            createdBy: ctx.users[1].id,
            amount: kind === 'incomes' ? 10 : 5,
          });
          expect(
            (
              await api(
                'get',
                `${base()}/${kind}?accountId=${accountId}`,
                user,
              ).expect(200)
            ).body,
          ).toMatchObject({
            total: 1,
            items: [expect.objectContaining({ _id: id })],
          });
        }
      }
      expect(
        (
          await api(
            'get',
            `${base()}/transactions?accountId=${accountId}`,
            2,
          ).expect(200)
        ).body,
      ).toMatchObject({ total: 2 });
      expect(
        (
          await api(
            'get',
            `${base()}/expenses/revenue?accountId=${accountId}`,
            2,
          ).expect(200)
        ).body,
      ).toMatchObject({ totalRevenue: 5 });
      expect(
        (await api('get', `${base()}/expense-limits/${limitId}`, 2).expect(200))
          .body,
      ).toMatchObject({ total: 15, rest: 10 });
      expect((await api('get', reportPath, 2).expect(200)).body).toEqual(
        report,
      );
      expect(
        await ctx.connection
          .collection('transactions')
          .find(filter)
          .sort({ _id: 1 })
          .toArray(),
      ).toEqual(rows);
      expect(
        await ctx.connection
          .collection('accountsnapshots')
          .find(filter)
          .sort({ _id: 1 })
          .toArray(),
      ).toEqual(snapshots);
      await api('patch', account()).send({ name: 'Historic' }).expect(200);
      await api('post', `${account()}/archive`).expect(404);
      await api('delete', account()).expect(409);
    },
  );

  it('deletes unused archived accounts and snapshots but restricts deleted history and opening money', async () => {
    const filter = { accountId: new Types.ObjectId(accountId) };
    expect(
      await ctx.connection
        .collection('accountsnapshots')
        .countDocuments(filter),
    ).toBeGreaterThan(0);
    await api('post', `${account()}/archive`).expect(204);
    await api('delete', account()).expect(204);
    expect(
      await ctx.connection
        .collection('accountsnapshots')
        .countDocuments(filter),
    ).toBe(0);
    await api('get', account()).expect(404);
    await api('delete', account()).expect(404);
    accountId = idOf(
      await api('post', `${base()}/accounts`)
        .send({
          name: 'Used',
          currency: 'USD',
          openedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201),
    );
    const incomeId = idOf(await createIncome().expect(201));
    await api('delete', `${base()}/incomes/${incomeId}`).expect(204);
    await api('post', `${account()}/archive`).expect(204);
    await api('delete', account()).expect(409);
    expect((await api('get', account()).expect(200)).body).toMatchObject({
      amount: 0,
    });
    accountId = idOf(
      await api('post', `${base()}/accounts`)
        .send({
          name: 'Opening',
          type: 'saving',
          currency: 'USD',
          amount: 1,
          openedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201),
    );
    await api('post', `${account()}/archive`).expect(204);
    await api('delete', account()).expect(409);
  });

  // The barrier delays only the first completed real group write; every MongoDB
  // lock, retry, permission check and financial effect remains real.
  async function race(
    first: () => PromiseLike<Response>,
    second: () => PromiseLike<Response>,
  ) {
    function signal() {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }
    async function wait(promise: Promise<void>) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('Group transaction barrier not reached')),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const access = ctx.app.get(GroupsAccessService);
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
      await wait(locked.promise);
      secondResponse = Promise.resolve(second());
      await wait(contender.promise);
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

  it.each([
    ['incomes', 'create'],
    ['incomes', 'patch'],
    ['incomes', 'delete'],
    ['expenses', 'create'],
    ['expenses', 'patch'],
    ['expenses', 'delete'],
  ] as const)(
    'serializes archive against %s %s in both orders without partial money effects',
    async (kind, action) => {
      const categoryId =
        kind === 'expenses'
          ? idOf(
              await api('post', `${base()}/expense-categories`)
                .send({ name: 'Racing expense' })
                .expect(201),
            )
          : undefined;
      const create = () =>
        kind === 'incomes'
          ? createIncome()
          : api('post', `${base()}/expenses`).send({
              accountId,
              categoryId,
              amount: 10,
              transactionDate: '2026-02-15T12:00:00Z',
            });
      for (const archiveFirst of [true, false]) {
        // Both orders use independent accounts and the same literal ledger values.
        accountId = idOf(
          await api('post', `${base()}/accounts`)
            .send({
              name: 'Racing',
              type: 'saving',
              currency: 'USD',
              openedAt: '2026-01-01T00:00:00Z',
            })
            .expect(201),
        );
        const incomeId =
          action === 'create' ? undefined : idOf(await create().expect(201));
        const change = () =>
          action === 'create'
            ? create()
            : action === 'patch'
              ? api('patch', `${base()}/${kind}/${incomeId}`).send({
                  amount: 20,
                })
              : api('delete', `${base()}/${kind}/${incomeId}`);
        const archive = () => api('post', `${account()}/archive`);
        const status =
          action === 'create' ? 201 : action === 'patch' ? 200 : 204;
        const responses = await race(
          archiveFirst ? archive : change,
          archiveFirst ? change : archive,
        );
        expect(responses.map(({ status }) => status)).toEqual(
          archiveFirst ? [204, 404] : [status, 204],
        );
        const unsignedAmount = archiveFirst
          ? action === 'create'
            ? 0
            : 10
          : action === 'create'
            ? 10
            : action === 'patch'
              ? 20
              : 0;
        const amount =
          kind === 'expenses' && unsignedAmount !== 0
            ? -unsignedAmount
            : unsignedAmount;
        expect((await api('get', account()).expect(200)).body).toMatchObject({
          amount,
          archivedAt: expect.any(String) as unknown,
        });
        const filter = { accountId: new Types.ObjectId(accountId) };
        const rows = await ctx.connection
          .collection('transactions')
          .find(filter)
          .toArray();
        expect(rows).toHaveLength(action === 'create' && archiveFirst ? 0 : 1);
        if (rows.length) {
          expect(rows[0].amount).toBe(
            action === 'patch' && !archiveFirst ? 20 : 10,
          );
          expect(rows[0].deletedAt ?? null).toEqual(
            action === 'delete' && !archiveFirst ? expect.any(Date) : null,
          );
        }
        const month = await ctx.connection
          .collection('accountsnapshots')
          .findOne({ ...filter, date: new Date('2026-02-28T23:59:59.999Z') });
        if (action === 'create' && archiveFirst) expect(month).toBeNull();
        else expect(month?.amount).toBe(amount);
      }
    },
  );

  it.each(['rename', 'archive'] as const)(
    'serializes revoke and member removal against delegated %s',
    async (action) => {
      for (const transition of ['revoke', 'remove'] as const) {
        for (const rightsFirst of [true, false]) {
          await join(1);
          await grant(true).expect(200);
          accountId = idOf(
            await api('post', `${base()}/accounts`)
              .send({ name: 'Before', currency: 'USD' })
              .expect(201),
          );
          const change = () =>
            action === 'rename'
              ? api('patch', account(), 1).send({ name: 'After' })
              : api('post', `${account()}/archive`, 1);
          const loseRights = () =>
            transition === 'revoke'
              ? grant(false)
              : api('delete', `${base()}/members/${ctx.users[1].id}`);
          const status = action === 'rename' ? 200 : 204;
          const transitionStatus = transition === 'revoke' ? 200 : 204;
          const denied = transition === 'revoke' ? 403 : 404;
          const responses = await race(
            rightsFirst ? loseRights : change,
            rightsFirst ? change : loseRights,
          );
          expect(responses.map(({ status }) => status)).toEqual(
            rightsFirst
              ? [transitionStatus, denied]
              : [status, transitionStatus],
          );
          expect((await api('get', account()).expect(200)).body).toMatchObject({
            name: action === 'rename' && !rightsFirst ? 'After' : 'Before',
            archivedAt:
              action === 'archive' && !rightsFirst
                ? (expect.any(String) as unknown)
                : null,
            amount: 0,
          });
          await change().expect(denied);
          if (transition === 'revoke')
            await api('delete', `${base()}/members/${ctx.users[1].id}`).expect(
              204,
            );
        }
      }
    },
  );
});
