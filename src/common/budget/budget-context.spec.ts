import { Types } from 'mongoose';
import { budgetFilter, groupBudget } from './budget-context';

describe('budget ownership filter', () => {
  it('uses only the owner keys even when supplied a structural account object', () => {
    const ownerId = new Types.ObjectId();
    const account = {
      ownerType: 'group' as const,
      ownerId,
      name: 'Not a query condition',
      type: 'balance',
      _id: new Types.ObjectId(),
    };
    expect(budgetFilter(account)).toEqual({ ownerType: 'group', ownerId });
    expect(budgetFilter({ ...account, ownerType: 'user' })).toEqual({
      ownerType: 'user',
      ownerId,
      userId: ownerId,
    });
    expect(groupBudget(String(ownerId))).toEqual({
      ownerType: 'group',
      ownerId,
    });
  });
});
