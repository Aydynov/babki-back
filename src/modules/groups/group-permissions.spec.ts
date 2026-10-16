import { effectivePermissions } from './group-permissions';

describe('effective group permissions', () => {
  it('grants all four rights to the owner, including legacy memberships', () => {
    expect(effectivePermissions(true)).toEqual({
      manageAccounts: true,
      manageCategories: true,
      manageLimits: true,
      manageTransactions: true,
    });
  });

  it('defaults missing transaction rights to false without resetting settings', () => {
    expect(effectivePermissions(false, { manageAccounts: true })).toEqual({
      manageAccounts: true,
      manageCategories: false,
      manageLimits: false,
      manageTransactions: false,
    });
  });

  it('keeps transaction management independent from settings', () => {
    const stored = { manageTransactions: true, manageAccounts: false };
    expect(effectivePermissions(false, stored)).toEqual({
      manageAccounts: false,
      manageCategories: false,
      manageLimits: false,
      manageTransactions: true,
    });
  });
});
