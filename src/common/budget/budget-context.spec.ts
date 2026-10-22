import { Types } from 'mongoose';
import { budgetFilter, spaceBudget } from './budget-context';
describe('budget ownership filter', () => {
  it('uses only the owner keys even when supplied a structural account object', () => {
    const spaceId = new Types.ObjectId();
    const account = {
      spaceId,
      name: 'Not a query condition',
      type: 'balance',
      _id: new Types.ObjectId(),
    };
    expect(budgetFilter(account)).toEqual({ spaceId });
    expect(budgetFilter({ ...account })).toEqual({
      spaceId,
    });
    expect(spaceBudget(String(spaceId))).toEqual({
      spaceId,
    });
  });
});
