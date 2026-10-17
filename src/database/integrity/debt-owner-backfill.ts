import { ClientSession, Connection, Types } from 'mongoose';

type RawRow = { _id: Types.ObjectId; [key: string]: unknown };
export type DebtOwnerBackfillReport = {
  mode: 'dry-run' | 'apply';
  scanned: number;
  candidates: number;
  updated: number;
  issues: { collection: string; documentId: string; reason: string }[];
};
const sameId = (a: unknown, b: unknown) =>
  a instanceof Types.ObjectId && b instanceof Types.ObjectId && a.equals(b);
const expectedOwner = (row: RawRow) => ({
  ownerType: 'user',
  ownerId: row.userId,
  createdBy: row.userId,
});
const compatible = (row: RawRow) =>
  Object.entries(expectedOwner(row)).every(
    ([key, value]) =>
      !(key in row) ||
      (key === 'ownerType' ? row[key] === value : sameId(row[key], value)),
  );
const cas = (row: RawRow, missing: Record<string, unknown>) => ({
  $and: [
    row,
    ...Object.keys(missing).map((key) => ({ [key]: { $exists: false } })),
  ],
});

/** Raw, parent-first owner metadata only. Never changes financial or history fields. */
export async function backfillDebtOwners(
  connection: Connection,
  options: { apply?: boolean } = {},
): Promise<DebtOwnerBackfillReport> {
  const report: DebtOwnerBackfillReport = {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: 0,
    candidates: 0,
    updated: 0,
    issues: [],
  };
  for (const name of ['debts', 'debttransactions']) {
    const collection = connection.collection<RawRow>(name);
    for await (const row of collection.find()) {
      report.scanned++;
      if (row.ownerType === 'group') continue;
      const fail = (reason: string) =>
        report.issues.push({
          collection: name,
          documentId: String(row._id),
          reason,
        });
      if (
        !(row._id instanceof Types.ObjectId) ||
        !(row.userId instanceof Types.ObjectId) ||
        !(await connection.collection('users').findOne({ _id: row.userId }))
      ) {
        fail('missing_or_invalid_user');
        continue;
      }
      if (!compatible(row)) {
        fail('conflicting_owner_or_creator');
        continue;
      }
      const missing = Object.fromEntries(
        Object.entries(expectedOwner(row)).filter(([key]) => !(key in row)),
      );
      const parentFor = async (session?: ClientSession) => {
        if (name === 'debts') return undefined;
        if (!(row.debtId instanceof Types.ObjectId)) return null;
        const parent = await connection
          .collection<RawRow>('debts')
          .findOne({ _id: row.debtId }, { session });
        if (
          !parent ||
          parent.ownerType === 'group' ||
          !sameId(parent.userId, row.userId) ||
          !compatible(parent)
        )
          return null;
        // In dry-run a compatible legacy parent is a candidate in the preceding pass.
        if (
          options.apply &&
          (parent.ownerType !== 'user' ||
            !sameId(parent.ownerId, row.userId) ||
            !sameId(parent.createdBy, row.userId))
        )
          return null;
        return parent;
      };
      if ((await parentFor()) === null) {
        fail('missing_or_cross_budget_parent');
        continue;
      }
      if (!Object.keys(missing).length) continue;
      report.candidates++;
      if (!options.apply) continue;
      const session = await connection.startSession();
      try {
        let changed = 0;
        await session.withTransaction(async () => {
          const parent = await parentFor(session);
          if (parent === null) throw new Error('concurrent_parent_change');
          if (parent) {
            // Lock the exact parent snapshot so concurrent reassignment cannot race history assignment.
            const lock = await connection
              .collection<RawRow>('debts')
              .updateOne(
                parent,
                { $set: { __debtOwnerBackfillLock: new Types.ObjectId() } },
                { session },
              );
            if (!lock.matchedCount) throw new Error('concurrent_parent_change');
            // A no-op update is not a write fence. Restore this temporary marker
            // in the same transaction so no extra parent field is committed.
            await connection.collection<RawRow>('debts').updateOne(
              { _id: parent._id },
              '__debtOwnerBackfillLock' in parent
                ? {
                    $set: {
                      __debtOwnerBackfillLock: parent.__debtOwnerBackfillLock,
                    },
                  }
                : { $unset: { __debtOwnerBackfillLock: '' } },
              { session },
            );
          }
          const result = await collection.updateOne(
            cas(row, missing),
            { $set: missing },
            { session },
          );
          if (!result.matchedCount) throw new Error('concurrent_change');
          changed = result.modifiedCount;
        });
        report.updated += changed;
      } catch (error) {
        if (
          error instanceof Error &&
          ['concurrent_change', 'concurrent_parent_change'].includes(
            error.message,
          )
        )
          fail(error.message);
        else throw error;
      } finally {
        await session.endSession();
      }
    }
  }
  return report;
}
