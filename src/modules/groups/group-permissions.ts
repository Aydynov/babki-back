export type GroupPermissions = {
  manageAccounts: boolean;
  manageCategories: boolean;
  manageLimits: boolean;
  manageTransactions: boolean;
};
export type GroupPermission = keyof GroupPermissions;
export function effectivePermissions(
  owner: boolean,
  permissions?: Partial<GroupPermissions>,
): GroupPermissions {
  return {
    manageAccounts: owner || permissions?.manageAccounts === true,
    manageCategories: owner || permissions?.manageCategories === true,
    manageLimits: owner || permissions?.manageLimits === true,
    manageTransactions: owner || permissions?.manageTransactions === true,
  };
}
export const permissionFields = {
  manageAccounts: { type: Boolean, default: false },
  manageCategories: { type: Boolean, default: false },
  manageLimits: { type: Boolean, default: false },
  manageTransactions: { type: Boolean, default: false },
};
