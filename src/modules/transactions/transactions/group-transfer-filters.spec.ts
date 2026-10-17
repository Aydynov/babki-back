import { Types } from 'mongoose';
import { groupBudget } from '../../../common/budget/budget-context';
import { TransactionsService } from './transactions.service';

describe('Group transfer effects in history filters', () => {
  const service = new TransactionsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const budget = groupBudget(new Types.ObjectId().toString());
  const accountId = new Types.ObjectId();
  it('matches either account side without restricting transfer to a top-level account', () => {
    const filter = service.buildFilterForBudget(budget, {
      accountId: String(accountId),
      transactionType: 'transfer',
    });
    expect(filter).not.toHaveProperty('accountId');
    expect(filter).toMatchObject({
      $or: [
        { accountId },
        { 'source.accountId': accountId },
        { 'destination.accountId': accountId },
      ],
    });
  });
  it('combines account and currency OR clauses with AND', () => {
    const filter = service.buildFilterForBudget(budget, {
      accountId: String(accountId),
      currency: 'USD',
    });
    expect(filter).not.toHaveProperty('currency');
    expect(filter).toMatchObject({
      $and: [
        {
          $or: [
            { currency: 'USD' },
            { 'source.currency': 'USD' },
            { 'destination.currency': 'USD' },
          ],
        },
        {
          $or: [
            { accountId },
            { 'source.accountId': accountId },
            { 'destination.accountId': accountId },
          ],
        },
      ],
    });
  });
});
