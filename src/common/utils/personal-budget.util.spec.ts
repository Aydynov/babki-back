import { Types } from 'mongoose';
import { personalBudget, personalResponse } from './personal-budget.util';

describe('personal budget boundary', () => {
  it('requires an explicit user budget owner', () => {
    const id = new Types.ObjectId();
    expect(personalBudget(id)).toEqual({
      userId: id,
      ownerType: 'user',
      ownerId: id,
    });
  });
  it('preserves BSON identifiers and dates but removes internal metadata recursively', () => {
    const id = new Types.ObjectId();
    const date = new Date();
    expect(
      personalResponse({
        _id: id,
        date,
        ownerType: 'user',
        ownerId: id,
        createdBy: id,
        participantId: id,
        mutationVersion: 1,
        category: { name: 'Food', ownerId: id },
      }),
    ).toEqual({ _id: id, date, category: { name: 'Food' } });
  });
});
