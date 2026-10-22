import { Connection, Types } from 'mongoose';
import { findDebtViolations } from './space-debt-integrity';

describe('space debt money integrity', () => {
  const spaceId = new Types.ObjectId();
  const debtId = new Types.ObjectId();
  async function audit(
    currency: unknown,
    principalAmount: number,
    remainingAmount: number,
    amounts: number[] = [],
  ) {
    const debt = {
      _id: debtId,
      spaceId,
      currency,
      principalAmount,
      remainingAmount,
      status: remainingAmount === 0 ? 'closed' : 'active',
    };
    const histories = amounts.map((amount) => ({
      _id: new Types.ObjectId(),
      spaceId,
      debtId,
      amount,
    }));
    const connection = {
      collection: (name: string) => ({
        find: () =>
          name === 'debts' ? [debt] : { toArray: async () => histories },
      }),
    } as unknown as Connection;
    return findDebtViolations(connection, 'balance');
  }
  it.each([
    ['USD', 100.00001, 100.00001, []],
    ['USD', 100, 99.9999, [0.0001]],
    ['USD', 100.0001, 100, [0.0001]],
    ['INVALID', 100, 100, []],
    [null, 100, 100, []],
  ])(
    'reports invalid money %s %s %s without throwing',
    async (currency, principal, remaining, amounts) => {
      expect(await audit(currency, principal, remaining, amounts)).toHaveLength(
        1,
      );
    },
  );
  it('uses currency normalization for computed sums and accepts valid USD/JPY/KWD precision', async () => {
    expect(await audit('USD', 1, 0.7, [0.1, 0.2])).toEqual([]);
    expect(await audit('JPY', 100, 99, [1])).toEqual([]);
    expect(await audit('KWD', 1, 0.999, [0.001])).toEqual([]);
  });
});
