import { describe, it, expect } from 'vitest';
import {
  toPaisa, fromPaisa, roundPaisa, formatMoney, formatMoneyCompact, formatQty, lineTax, sumPaisa
} from '../money';

describe('money — integer paisa', () => {
  it('converts rupees to integer paisa without floating point drift', () => {
    expect(toPaisa(1234.56)).toBe(123456);
    expect(toPaisa('1234.56')).toBe(123456);
    expect(toPaisa(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30 paisa
    expect(Number.isInteger(toPaisa(19.999))).toBe(true);
  });

  it('rounds half away from zero and never returns fractional paisa', () => {
    expect(roundPaisa(10.4)).toBe(10);
    expect(roundPaisa(10.5)).toBe(11);
    expect(roundPaisa(-10.5)).toBe(-10); // Math.round semantics, documented
    expect(fromPaisa(123456)).toBe(1234.56);
  });

  it('formats money with the workshop currency', () => {
    expect(formatMoney(123456, { currency: 'Rs.' })).toContain('1,234.56');
    expect(formatMoney(123456, { currency: 'Rs.', decimals: false })).toContain('1,235');
    expect(formatMoney(0, { currency: 'Rs.' })).toContain('0.00');
  });

  it('uses lakh/crore suffixes for compact figures', () => {
    expect(formatMoneyCompact(150_000_00, 'Rs.')).toBe('Rs. 1.50L');
    expect(formatMoneyCompact(25_000_000_00, 'Rs.')).toBe('Rs. 2.50Cr');
    expect(formatMoneyCompact(65_050_00, 'Rs.')).toBe('Rs. 65,050');
  });

  it('computes line tax on the discounted base', () => {
    expect(lineTax(100_000, 17)).toBe(17_000);
    expect(lineTax(100_000, 0)).toBe(0);
  });

  it('sums paisa as integers', () => {
    expect(sumPaisa([100.4, 100.4, 100.4])).toBe(300);
  });

  it('formats quantities without trailing zeros', () => {
    expect(formatQty(2)).toBe('2');
    expect(formatQty(2.5)).toBe('2.5');
    expect(formatQty(0.25)).toBe('0.25');
  });
});
