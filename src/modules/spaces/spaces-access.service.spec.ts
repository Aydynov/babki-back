import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SpacesAccessService } from './spaces-access.service';
import { Types } from 'mongoose';
describe('SpacesAccessService', () => {
  const space = { ownerId: 'owner' };
  const spaces = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const memberships = { exists: jest.fn(), findOne: jest.fn() };
  const query = (value: unknown) => ({
    session: jest.fn().mockResolvedValue(value),
  });
  const service = new SpacesAccessService(
    spaces as never,
    memberships as never,
  );
  beforeEach(() => {
    spaces.findOne.mockReturnValue(query(space));
    memberships.exists.mockReturnValue(query({ _id: 'membership' }));
  });
  it('conceals a space from a former member', async () => {
    memberships.exists.mockReturnValue(query(null));
    await expect(
      service.requireMember('space', 'former'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects owner-only access for an active member', async () => {
    await expect(
      service.requireOwner('space', 'member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('accepts the current owner', async () => {
    await expect(service.requireOwner('space', 'owner')).resolves.toBe(space);
  });
  it('conceals deleted spaces', async () => {
    spaces.findOne.mockReturnValue(query(null));
    await expect(
      service.requireMember('space', 'owner'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('checks current delegation and defaults legacy rights without granting settings', async () => {
    const ownerId = new Types.ObjectId();
    const memberId = new Types.ObjectId().toString();
    spaces.findOne.mockReturnValue(query({ ownerId }));
    memberships.findOne.mockReturnValue(
      query({ permissions: { manageCategories: true } }),
    );
    expect(
      (await service.memberContext('space', memberId)).permissions,
    ).toEqual({
      manageAccounts: false,
      manageCategories: true,
      manageLimits: false,
      manageTransactions: false,
    });
    await expect(
      service.requirePermission('space', memberId, 'manageTransactions'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    memberships.findOne.mockReturnValue(
      query({ permissions: { manageTransactions: true } }),
    );
    await expect(
      service.requirePermission('space', memberId, 'manageTransactions'),
    ).resolves.toMatchObject({ ownerId });
    await expect(
      service.requirePermission('space', memberId, 'manageAccounts'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (await service.memberContext('space', String(ownerId))).permissions,
    ).toEqual({
      manageAccounts: true,
      manageCategories: true,
      manageLimits: true,
      manageTransactions: true,
    });
    memberships.findOne.mockReturnValue(query(null));
    await expect(
      service.memberContext('space', memberId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
