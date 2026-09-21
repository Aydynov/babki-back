import { Types } from 'mongoose';
import { seedGroups } from '../src/database/seeds/08-groups';
import { startGroupsTestApp } from './helpers/groups-test-app';

describe('Group finances development seed (real replica set)', () => {
  let fixture: Awaited<ReturnType<typeof startGroupsTestApp>>;

  beforeAll(async () => {
    fixture = await startGroupsTestApp();
  }, 60000);

  afterAll(async () => {
    await fixture?.close();
  });

  it('creates independent manual-testing scenarios', async () => {
    const [alex, maria, ivan, elena] = fixture.users;
    const result = await seedGroups(
      fixture.app,
      {
        alex: alex.id,
        maria: maria.id,
        ivan: ivan.id,
        elena: elena.id,
      },
      new Date('2030-03-21T12:00:00.000Z'),
    );
    const groupIds = [
      result.family.id,
      result.studio.id,
      result.agency.id,
      result.sandbox.id,
    ].map((id) => new Types.ObjectId(id));

    expect(
      await fixture.connection.collection('groups').countDocuments({
        _id: { $in: groupIds },
      }),
    ).toBe(4);
    expect(
      await fixture.connection.collection('accounts').countDocuments({
        ownerType: 'group',
        ownerId: { $in: groupIds },
      }),
    ).toBe(3);
    expect(
      await fixture.connection.collection('transactions').countDocuments({
        ownerType: 'group',
        ownerId: { $in: groupIds },
      }),
    ).toBe(8);

    const attributedExpense = await fixture.connection
      .collection('transactions')
      .findOne({
        ownerId: new Types.ObjectId(result.family.id),
        createdBy: new Types.ObjectId(alex.id),
        participantId: new Types.ObjectId(maria.id),
      });
    expect(attributedExpense?.description).toBe('Покупки за Марию');

    const formerMember = await fixture.connection
      .collection('groupmemberships')
      .findOne({
        groupId: new Types.ObjectId(result.family.id),
        userId: new Types.ObjectId(elena.id),
      });
    expect(formerMember).toMatchObject({
      status: 'left',
      permissions: {
        manageAccounts: false,
        manageCategories: false,
        manageLimits: false,
      },
    });

    const mariaMembership = await fixture.connection
      .collection('groupmemberships')
      .findOne({
        groupId: new Types.ObjectId(result.family.id),
        userId: new Types.ObjectId(maria.id),
      });
    expect(mariaMembership?.permissions).toEqual({
      manageAccounts: true,
      manageCategories: true,
      manageLimits: true,
    });
    expect(
      await fixture.connection.collection('groupinvitations').countDocuments({
        groupId: new Types.ObjectId(result.sandbox.id),
        status: 'pending',
      }),
    ).toBe(1);
    expect(result.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
