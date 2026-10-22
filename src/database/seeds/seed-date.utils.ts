export function getSeedDate(
  monthOffset: number,
  day: number,
  anchorDate: Date = new Date(),
) {
  const year = anchorDate.getUTCFullYear();
  const month = anchorDate.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > lastDay) {
    throw new RangeError(
      `Day ${day} is invalid for seed month offset ${monthOffset}.`,
    );
  }
  return new Date(Date.UTC(year, month, day)).toISOString();
}
export function getSeedMonthRange(
  monthOffset: number = 0,
  anchorDate: Date = new Date(),
) {
  const year = anchorDate.getUTCFullYear();
  const month = anchorDate.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    startDate: getSeedDate(monthOffset, 1, anchorDate),
    endDate: getSeedDate(monthOffset, lastDay, anchorDate),
  };
}
