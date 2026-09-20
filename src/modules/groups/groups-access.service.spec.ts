import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupsAccessService } from './groups-access.service';

describe('GroupsAccessService', () => {
  const group = { ownerId: 'owner' };
  const groups = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const memberships = { exists: jest.fn() };
  const query = (value: unknown) => ({
    session: jest.fn().mockResolvedValue(value),
  });
  const service = new GroupsAccessService(
    groups as never,
    memberships as never,
  );
  beforeEach(() => {
    groups.findOne.mockReturnValue(query(group));
    memberships.exists.mockReturnValue(query({ _id: 'membership' }));
  });
  it('conceals a group from a former member', async () => {
    memberships.exists.mockReturnValue(query(null));
    await expect(
      service.requireMember('group', 'former'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects owner-only access for an active member', async () => {
    await expect(
      service.requireOwner('group', 'member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('accepts the current owner', async () => {
    await expect(service.requireOwner('group', 'owner')).resolves.toBe(group);
  });
  it('conceals deleted groups', async () => {
    groups.findOne.mockReturnValue(query(null));
    await expect(
      service.requireMember('group', 'owner'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
