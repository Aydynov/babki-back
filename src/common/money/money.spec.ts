import {
  getCurrencyMinorUnits,
  hasValidMoneyPrecision,
  normalizeCurrency,
  normalizeMoney,
} from './money';

describe('money utilities', () => {
  it('normalizes supported ISO 4217 codes', () => {
    expect(normalizeCurrency(' rub ')).toBe('RUB');
    expect(() => normalizeCurrency('ZZZ')).toThrow('Unsupported currency');
  });

  it('uses currency-specific minor units', () => {
    expect(getCurrencyMinorUnits('RUB')).toBe(2);
    expect(getCurrencyMinorUnits('JPY')).toBe(0);
    expect(getCurrencyMinorUnits('KWD')).toBe(3);
  });

  it('rejects amounts with hidden precision', () => {
    expect(hasValidMoneyPrecision(125.5, 'RUB')).toBe(true);
    expect(hasValidMoneyPrecision(125.501, 'RUB')).toBe(false);
    expect(hasValidMoneyPrecision(1.2, 'JPY')).toBe(false);
  });

  it('normalizes arithmetic to the currency precision', () => {
    expect(normalizeMoney(0.1 + 0.2, 'USD')).toBe(0.3);
    expect(normalizeMoney(1.2345, 'KWD')).toBe(1.235);
  });
});
