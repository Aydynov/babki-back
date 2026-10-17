import { Connection, Types } from 'mongoose';
import {
  hasValidMoneyPrecision,
  normalizeMoney,
  SUPPORTED_CURRENCY_CODES,
} from '../../common/money/money';
import { OrphanReference } from './integrity-audit';
import { IntegrityRelation } from './integrity-relations';

type Row = { _id: Types.ObjectId; [key: string]: unknown };
const sameId = (a: unknown, b: unknown) =>
  a instanceof Types.ObjectId && b instanceof Types.ObjectId && a.equals(b);
const sameBudget = (a: Row, b: Row) =>
  a.ownerType === b.ownerType && sameId(a.ownerId, b.ownerId);
const sameDate = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
const cancelled = (row: Row) => row.cancelledAt != null;
const linkMatches = (history: Row, income: Row, debt: Row) => {
  const origin = income.origin as { type?: string; id?: unknown } | undefined;
  return (
    income.type === 'income' &&
    sameBudget(history, income) &&
    sameBudget(history, debt) &&
    sameId(history.debtId, debt._id) &&
    sameId(history.incomeId, income._id) &&
    origin?.type === 'debt' &&
    sameId(origin.id, debt._id) &&
    income.amount === history.amount &&
    income.currency === debt.currency &&
    sameDate(income.transactionDate, history.transactionDate) &&
    sameId(income.createdBy, history.createdBy) &&
    (income.deletedAt != null) === cancelled(history)
  );
};

/** Read-only group checks: personal manual balances and unlinked legacy history remain valid. */
export async function findDebtViolations(
  connection: Connection,
  check: NonNullable<IntegrityRelation['debtCheck']>,
): Promise<OrphanReference[]> {
  const debts = connection.collection<Row>('debts');
  const histories = connection.collection<Row>('debttransactions');
  const incomes = connection.collection<Row>('transactions');
  const violations: OrphanReference[] = [];
  const fail = (row: Row, target: unknown) =>
    violations.push({
      sourceId: String(row._id),
      targetId:
        target instanceof Types.ObjectId || typeof target === 'string'
          ? String(target)
          : '',
    });
  if (check === 'balance') {
    for await (const debt of debts.find({ ownerType: 'group' })) {
      const rows = await histories.find({ debtId: debt._id }).toArray();
      const currency = debt.currency;
      if (
        typeof currency !== 'string' ||
        !SUPPORTED_CURRENCY_CODES.includes(currency) ||
        typeof debt.principalAmount !== 'number' ||
        debt.principalAmount <= 0 ||
        !hasValidMoneyPrecision(debt.principalAmount, currency) ||
        typeof debt.remainingAmount !== 'number' ||
        debt.remainingAmount < 0 ||
        !hasValidMoneyPrecision(debt.remainingAmount, currency) ||
        rows.some(
          (row) =>
            !sameBudget(row, debt) ||
            typeof row.amount !== 'number' ||
            row.amount <= 0 ||
            !hasValidMoneyPrecision(row.amount, currency),
        )
      ) {
        fail(debt, debt._id);
        continue;
      }
      const sum = rows
        .filter((row) => !cancelled(row))
        .reduce((total, row) => total + Number(row.amount), 0);
      const remaining = normalizeMoney(debt.principalAmount - sum, currency);
      if (
        remaining !== debt.remainingAmount ||
        remaining < 0 ||
        debt.status !== (remaining === 0 ? 'closed' : 'active')
      )
        fail(debt, debt._id);
    }
  } else if (check === 'repayment-income') {
    for await (const row of histories.find({ ownerType: 'group' })) {
      const debt =
        row.debtId instanceof Types.ObjectId
          ? await debts.findOne({ _id: row.debtId })
          : null;
      if (row.isIncome === false) {
        if ('incomeId' in row) fail(row, row.incomeId);
        continue;
      }
      const income =
        row.incomeId instanceof Types.ObjectId
          ? await incomes.findOne({ _id: row.incomeId })
          : null;
      if (
        row.isIncome !== true ||
        !debt ||
        !income ||
        !linkMatches(row, income, debt) ||
        (await histories.countDocuments({ incomeId: row.incomeId })) !== 1
      )
        fail(row, row.incomeId);
    }
  } else {
    for await (const income of incomes.find({
      ownerType: 'group',
      type: 'income',
      'origin.type': 'debt',
    })) {
      const rows = await histories.find({ incomeId: income._id }).toArray();
      const row = rows[0];
      const debt =
        row?.debtId instanceof Types.ObjectId
          ? await debts.findOne({ _id: row.debtId })
          : null;
      if (
        rows.length !== 1 ||
        !row ||
        row.isIncome !== true ||
        !debt ||
        !linkMatches(row, income, debt)
      )
        fail(income, row?._id);
    }
  }
  return violations;
}
