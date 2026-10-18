import { model, Schema, Types } from 'mongoose';
import { omitResponseFields } from './response-fields.util';
import { personalResponse } from './personal-budget.util';

describe('response field omission', () => {
  it('preserves public identities, dates and money without changing nested source objects', () => {
    const id = new Types.ObjectId();
    const date = new Date('2024-01-01T00:00:00Z');
    const fields = new Set(['__v', 'mutationVersion', 'lockVersion']);
    const row = {
      _id: id,
      ownerId: id,
      createdAt: date,
      amount: -0.001,
      __v: 2,
      mutationVersion: 3,
      timeline: [{ date, amount: 0, __v: 1 }],
      compound: { lockVersion: 4, actor: { firstName: null } },
    };
    expect(omitResponseFields({ items: [row], total: 1 }, fields)).toEqual({
      items: [
        {
          _id: id,
          ownerId: id,
          createdAt: date,
          amount: -0.001,
          timeline: [{ date, amount: 0 }],
          compound: { actor: { firstName: null } },
        },
      ],
      total: 1,
    });
    expect(row.mutationVersion).toBe(3);
    expect(row.timeline[0].__v).toBe(1);
    expect(omitResponseFields(id, fields)).toBe(id);
    expect(omitResponseFields(date, fields)).toBe(date);
    expect(omitResponseFields(undefined, fields)).toBeUndefined();
    expect(omitResponseFields(null, fields)).toBeNull();
  });

  it('supports Mongoose documents and preserves the exact personal omission policy', () => {
    const TestDocument = model(
      'ResponseFieldsTest',
      new Schema({ name: String, mutationVersion: Number }),
    );
    const doc = new TestDocument({ name: 'Cash', mutationVersion: 9 });
    expect(omitResponseFields(doc, new Set(['mutationVersion']))).toEqual({
      _id: doc._id,
      name: 'Cash',
    });
    expect(doc.mutationVersion).toBe(9);
    const row = {
      ownerType: 'user',
      mutationVersion: 3,
      __v: 7,
      initialAmount: 1,
      openedAt: '2024-01-01',
      amount: 2,
      nested: { createdBy: 'actor', __v: 8 },
    };
    expect(personalResponse(row)).toEqual({
      __v: 7,
      amount: 2,
      nested: { __v: 8 },
    });
  });
});
