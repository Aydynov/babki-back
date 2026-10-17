import { Connection, Types } from 'mongoose';

type RawRow = { _id: Types.ObjectId; [key: string]: unknown };
export type PlanOwnerBackfillReport = {
  mode: 'dry-run' | 'apply';
  scanned: number;
  candidates: number;
  updated: number;
  issues: { planId: string; reason: string }[];
};

const sameId = (left: unknown, right: unknown) =>
  left instanceof Types.ObjectId &&
  right instanceof Types.ObjectId &&
  left.equals(right);
const objectId = (value: unknown): Types.ObjectId | undefined =>
  value instanceof Types.ObjectId ? value : undefined;

/** This deliberately uses raw collections: no defaults, timestamps or financial writes. */
export async function backfillPlanOwners(
  connection: Connection,
  options: { apply?: boolean } = {},
): Promise<PlanOwnerBackfillReport> {
  const report: PlanOwnerBackfillReport = {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: 0,
    candidates: 0,
    updated: 0,
    issues: [],
  };
  const plans = connection.collection<RawRow>('plans');
  for await (const row of plans.find()) {
    report.scanned++;
    // A group plan is never a personal migration candidate.
    if (row.ownerType === 'group') continue;
    const fail = (reason: string) =>
      report.issues.push({ planId: String(row._id), reason });
    const userId = objectId(row.userId);
    if (
      !userId ||
      !(await connection
        .collection<RawRow>('users')
        .findOne({ _id: userId }, { projection: { _id: 1 } }))
    ) {
      fail('missing_or_invalid_user');
      continue;
    }
    const expected = { ownerType: 'user', ownerId: userId, createdBy: userId };
    const conflict = Object.entries(expected).some(
      ([key, value]) =>
        key in row &&
        (key === 'ownerType' ? row[key] !== value : !sameId(row[key], value)),
    );
    if (conflict) {
      fail('conflicting_owner_or_creator');
      continue;
    }
    const budgetMatches = (target: RawRow) =>
      target.ownerType === 'user' &&
      sameId(target.ownerId, userId) &&
      (target.userId == null || sameId(target.userId, userId));
    const categoryId = objectId(row.categoryId);
    const category =
      categoryId &&
      (await connection
        .collection<RawRow>('expensecategories')
        .findOne({ _id: categoryId }));
    if (!category || !budgetMatches(category)) {
      fail('missing_or_cross_budget_category');
      continue;
    }
    if (row.status === 'closed' && row.expenseId == null) {
      fail('closed_plan_missing_expense');
      continue;
    }
    if (row.expenseId != null) {
      const expenseId = objectId(row.expenseId);
      const expense =
        expenseId &&
        (await connection
          .collection<RawRow>('transactions')
          .findOne({ _id: expenseId }));
      const origin = expense?.origin as
        { type?: string; id?: unknown } | undefined;
      const expenseCategoryId = objectId(expense?.category);
      const expenseCategory =
        expenseCategoryId &&
        (await connection
          .collection<RawRow>('expensecategories')
          .findOne({ _id: expenseCategoryId }));
      if (
        !expense ||
        expense.type !== 'expense' ||
        !budgetMatches(expense) ||
        !expenseCategory ||
        !budgetMatches(expenseCategory) ||
        origin?.type !== 'plan' ||
        !sameId(origin.id, row._id) ||
        row.status !== 'closed'
      ) {
        fail('missing_or_inconsistent_expense_origin');
        continue;
      }
    }
    const missing = Object.fromEntries(
      Object.entries(expected).filter(([key]) => !(key in row)),
    );
    if (Object.keys(missing).length === 0) continue;
    report.candidates++;
    if (!options.apply) continue;
    // CAS the complete raw document so a concurrent edit cannot be silently blessed.
    const result = await plans.updateOne(
      {
        $and: [
          row,
          ...Object.keys(missing).map((key) => ({ [key]: { $exists: false } })),
        ],
      },
      { $set: missing },
    );
    report.updated += result.modifiedCount;
    if (!result.matchedCount) fail('concurrent_change');
  }
  return report;
}
