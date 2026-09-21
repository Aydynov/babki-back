import { Types } from 'mongoose';

export function personalBudget(userId: string | Types.ObjectId) {
  const id = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  return { userId: id, ownerType: 'user' as const, ownerId: id };
}

const internalFields = new Set([
  'ownerType',
  'ownerId',
  'createdBy',
  'participantId',
  'mutationVersion',
  'deletedAt',
  'deletedBy',
  'initialAmount',
  'openedAt',
]);

/** Keep the legacy personal wire format, including populated categories. */
export function personalResponse<T>(value: T): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    value instanceof Date ||
    value instanceof Types.ObjectId
  )
    return value;
  if (Array.isArray(value))
    return value.map((item: unknown) => personalResponse(item)) as T;
  const plain =
    'toObject' in value && typeof value.toObject === 'function'
      ? (value.toObject as () => Record<string, unknown>)()
      : value;
  return Object.fromEntries(
    Object.entries(plain)
      .filter(([key]) => !internalFields.has(key))
      .map(([key, item]) => [key, personalResponse(item)]),
  ) as T;
}
