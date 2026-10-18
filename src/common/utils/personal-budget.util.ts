import { Types } from 'mongoose';
import { omitResponseFields } from './response-fields.util';

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
  return omitResponseFields(value, internalFields);
}
