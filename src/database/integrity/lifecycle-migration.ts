export type LifecycleBackfill = {
  id: string;
  model: string;
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
};

export type PlanOriginCandidate = {
  planId: string;
  expenseId: string;
};

export type PlanOriginResult =
  | 'updated'
  | 'already_set'
  | 'missing'
  | 'conflict';

export interface LifecycleMigrationStore {
  applyBackfill(step: LifecycleBackfill): Promise<number>;
  findPlanOrigins(): Promise<PlanOriginCandidate[]>;
  setPlanOriginIfMissing(candidate: PlanOriginCandidate): Promise<PlanOriginResult>;
  findLegacyDebtIncomeCandidates(): Promise<Array<{ transactionId: string }>>;
}

export type MigrationAmbiguity = {
  relation: 'plan.expenseOrigin' | 'debt.incomeOrigin';
  sourceId: string;
  targetId?: string;
  reason:
    | 'missing_target'
    | 'conflicting_origin'
    | 'legacy_income_cannot_be_mapped_safely';
};

export type LifecycleMigrationResult = {
  ok: boolean;
  updatedDocuments: number;
  backfills: Record<string, number>;
  ambiguous: MigrationAmbiguity[];
};

export const lifecycleBackfills: LifecycleBackfill[] = [
  missingField('account.archivedAt', 'Account', 'archivedAt', null),
  missingField('account.mutationVersion', 'Account', 'mutationVersion', 0),
  missingField('plan.archivedAt', 'Plan', 'archivedAt', null),
  missingField('debt.archivedAt', 'Debt', 'archivedAt', null),
  missingField(
    'category.mutationVersion',
    'ExpenseCategory',
    'mutationVersion',
    0,
  ),
  missingField('user.status', 'User', 'status', 'active'),
  missingField('user.deletedAt', 'User', 'deletedAt', null),
  missingField('transaction.deletedAt', 'Transaction', 'deletedAt', null),
  missingField('transaction.origin', 'Transaction', 'origin', null),
  {
    id: 'membership.leftReason',
    model: 'GroupMembership',
    filter: { status: 'left', endReason: null },
    update: { $set: { endReason: 'member_left' } },
  },
  {
    id: 'membership.removedReason',
    model: 'GroupMembership',
    filter: { status: 'removed', endReason: null },
    update: { $set: { endReason: 'member_removed' } },
  },
  {
    id: 'invitation.revocationReason',
    model: 'GroupInvitation',
    filter: { status: 'revoked', revocationReason: null },
    update: { $set: { revocationReason: 'manual' } },
  },
];

export async function runLifecycleMigration(
  store: LifecycleMigrationStore,
): Promise<LifecycleMigrationResult> {
  const backfills: Record<string, number> = {};
  let updatedDocuments = 0;
  const ambiguous: MigrationAmbiguity[] = [];

  for (const step of lifecycleBackfills) {
    const modified = await store.applyBackfill(step);
    backfills[step.id] = modified;
    updatedDocuments += modified;
  }

  for (const candidate of await store.findPlanOrigins()) {
    const result = await store.setPlanOriginIfMissing(candidate);
    if (result === 'updated') {
      updatedDocuments += 1;
    } else if (result === 'missing' || result === 'conflict') {
      ambiguous.push({
        relation: 'plan.expenseOrigin',
        sourceId: candidate.planId,
        targetId: candidate.expenseId,
        reason:
          result === 'missing' ? 'missing_target' : 'conflicting_origin',
      });
    }
  }

  for (const candidate of await store.findLegacyDebtIncomeCandidates()) {
    ambiguous.push({
      relation: 'debt.incomeOrigin',
      sourceId: candidate.transactionId,
      reason: 'legacy_income_cannot_be_mapped_safely',
    });
  }

  return {
    ok: ambiguous.length === 0,
    updatedDocuments,
    backfills,
    ambiguous,
  };
}

function missingField(
  id: string,
  model: string,
  field: string,
  value: unknown,
): LifecycleBackfill {
  return {
    id,
    model,
    filter: { [field]: { $exists: false } },
    update: { $set: { [field]: value } },
  };
}
