import {
  lifecycleBackfills,
  LifecycleMigrationStore,
  runLifecycleMigration,
} from './lifecycle-migration';

describe('entity deletion lifecycle migration', () => {
  it('only backfills missing/default-compatible fields', () => {
    expect(lifecycleBackfills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'account.archivedAt',
          filter: { archivedAt: { $exists: false } },
          update: { $set: { archivedAt: null } },
        }),
        expect.objectContaining({
          id: 'category.mutationVersion',
          filter: { mutationVersion: { $exists: false } },
          update: { $set: { mutationVersion: 0 } },
        }),
        expect.objectContaining({
          id: 'user.status',
          filter: { status: { $exists: false } },
          update: { $set: { status: 'active' } },
        }),
        expect.objectContaining({
          id: 'membership.leftReason',
          filter: { status: 'left', endReason: null },
          update: { $set: { endReason: 'member_left' } },
        }),
        expect.objectContaining({
          id: 'invitation.revocationReason',
          filter: { status: 'revoked', revocationReason: null },
          update: { $set: { revocationReason: 'manual' } },
        }),
      ]),
    );
  });

  it('is resumable and reports ambiguous financial origins without guessing', async () => {
    const applied = new Set<string>();
    const originState = new Map<string, string>();
    const store: LifecycleMigrationStore = {
      applyBackfill: jest.fn(async (step) => {
        if (applied.has(step.id)) return 0;
        applied.add(step.id);
        return 1;
      }),
      findPlanOrigins: jest.fn().mockResolvedValue([
        { planId: 'plan-1', expenseId: 'expense-1' },
        { planId: 'plan-2', expenseId: 'expense-missing' },
      ]),
      setPlanOriginIfMissing: jest.fn(async ({ planId, expenseId }) => {
        if (expenseId === 'expense-missing') return 'missing' as const;
        if (originState.get(expenseId) === planId) return 'already_set' as const;
        originState.set(expenseId, planId);
        return 'updated' as const;
      }),
      findLegacyDebtIncomeCandidates: jest
        .fn()
        .mockResolvedValue([{ transactionId: 'income-1' }]),
    };

    const first = await runLifecycleMigration(store);
    const second = await runLifecycleMigration(store);

    expect(first.updatedDocuments).toBe(lifecycleBackfills.length + 1);
    expect(second.updatedDocuments).toBe(0);
    expect(first.ambiguous).toEqual([
      {
        relation: 'plan.expenseOrigin',
        sourceId: 'plan-2',
        targetId: 'expense-missing',
        reason: 'missing_target',
      },
      {
        relation: 'debt.incomeOrigin',
        sourceId: 'income-1',
        reason: 'legacy_income_cannot_be_mapped_safely',
      },
    ]);
    expect(second.ambiguous).toEqual(first.ambiguous);
  });
});
