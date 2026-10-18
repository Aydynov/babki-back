import { Types } from 'mongoose';

/** Copy response data while preserving native dates and identifiers. */
export function omitResponseFields<T>(
  value: T,
  fields: ReadonlySet<string>,
): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    value instanceof Date ||
    value instanceof Types.ObjectId
  )
    return value;
  if (Array.isArray(value))
    return value.map((item: unknown) => omitResponseFields(item, fields)) as T;
  const plain =
    'toObject' in value && typeof value.toObject === 'function'
      ? (value.toObject as () => Record<string, unknown>)()
      : value;
  return Object.fromEntries(
    Object.entries(plain)
      .filter(([key]) => !fields.has(key))
      .map(([key, item]) => [key, omitResponseFields(item, fields)]),
  ) as T;
}
