type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf(key: 'currency'): string[];
};

const supportedCurrencyCodes = new Set(
  (Intl as IntlWithSupportedValues).supportedValuesOf('currency'),
);

export const SUPPORTED_CURRENCY_CODES = Object.freeze(
  [...supportedCurrencyCodes].sort(),
);

export function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!supportedCurrencyCodes.has(currency)) {
    throw new Error(`Unsupported currency: ${value}`);
  }
  return currency;
}

export function getCurrencyMinorUnits(currency: string): number {
  const normalized = normalizeCurrency(currency);
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalized,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function normalizeMoney(amount: number, currency: string): number {
  const factor = 10 ** getCurrencyMinorUnits(currency);
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

export function hasValidMoneyPrecision(
  amount: number,
  currency: string,
): boolean {
  return (
    Number.isFinite(amount) &&
    Math.abs(amount - normalizeMoney(amount, currency)) < Number.EPSILON * 10
  );
}
