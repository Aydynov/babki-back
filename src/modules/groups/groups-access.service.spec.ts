import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupsAccessService } from './groups-access.service';
import { Types } from 'mongoose';

describe('GroupsAccessService', () => {
  const group = { ownerId: 'owner' };
  const groups = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const memberships = { exists: jest.fn(), findOne: jest.fn() };
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
  it('checks current delegation and defaults legacy rights without granting settings', async () => {
    const ownerId = new Types.ObjectId();
    const memberId = new Types.ObjectId().toString();
    groups.findOne.mockReturnValue(query({ ownerId }));
    memberships.findOne.mockReturnValue(
      query({ permissions: { manageCategories: true } }),
    );
    expect(
      (await service.memberContext('group', memberId)).permissions,
    ).toEqual({
      manageAccounts: false,
      manageCategories: true,
      manageLimits: false,
      manageTransactions: false,
    });
    await expect(
      service.requirePermission('group', memberId, 'manageTransactions'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    memberships.findOne.mockReturnValue(
      query({ permissions: { manageTransactions: true } }),
    );
    await expect(
      service.requirePermission('group', memberId, 'manageTransactions'),
    ).resolves.toMatchObject({ ownerId });
    await expect(
      service.requirePermission('group', memberId, 'manageAccounts'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (await service.memberContext('group', String(ownerId))).permissions,
    ).toEqual({
      manageAccounts: true,
      manageCategories: true,
      manageLimits: true,
      manageTransactions: true,
    });
    memberships.findOne.mockReturnValue(query(null));
    await expect(
      service.memberContext('group', memberId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
