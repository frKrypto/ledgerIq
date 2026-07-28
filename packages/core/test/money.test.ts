import { describe, expect, it } from 'vitest';
import * as M from '../src/money.js';

/**
 * Money tests.
 *
 * 100% branch coverage is required here and on the metric catalog, and nowhere
 * else (docs/03-engineering/testing.md §2). This is the code where a rounding
 * error becomes a wrong number in front of a customer.
 *
 * Several of these are property-style: they assert invariants over generated
 * inputs rather than checking hand-picked examples, because the failures that
 * matter here live in the values nobody thinks to write down.
 */

const CENTS = (n: number) => M.money(n, 'USD');

describe('construction', () => {
  it('rejects non-integer minor units', () => {
    expect(() => M.minorUnits(10.5)).toThrow(M.MoneyError);
  });

  it('rejects unsafe integers', () => {
    expect(() => M.minorUnits(Number.MAX_SAFE_INTEGER + 2)).toThrow(M.MoneyError);
  });
});

describe('fromDecimalString', () => {
  it.each([
    ['14200.00', 1_420_000],
    ['14200', 1_420_000],
    ['0.01', 1],
    ['0.10', 10],
    ['-1234.56', -123_456],
    ['0', 0],
    ['-0.00', 0],
    ['999999.99', 99_999_999],
  ])('parses %s', (input, expected) => {
    expect(M.fromDecimalString(input, 'USD').minorUnits).toBe(expected);
  });

  it('accepts trailing zeros beyond the currency precision', () => {
    // Postgres NUMERIC(20,4) yields "14200.0000" for a USD amount.
    expect(M.fromDecimalString('14200.0000', 'USD').minorUnits).toBe(1_420_000);
  });

  it('refuses to silently truncate real precision', () => {
    // 0.005 USD is a third of a cent. Dropping it silently is how reconciliation
    // differences appear months later with no traceable cause.
    expect(() => M.fromDecimalString('10.005', 'USD')).toThrow(/precision/);
  });

  it('rounds only when explicitly asked', () => {
    expect(M.roundToMinorUnits('10.005', 'USD').minorUnits).toBe(1001);
    expect(M.roundToMinorUnits('-10.005', 'USD').minorUnits).toBe(-1001);
  });

  it.each(['', 'abc', '1.2.3', '1,200.00', '1e5', ' ', '--5'])(
    'rejects malformed input %j',
    (bad) => {
      expect(() => M.fromDecimalString(bad, 'USD')).toThrow(M.MoneyError);
    },
  );
});

describe('round-trip invariant', () => {
  it('toDecimalString ∘ fromDecimalString is identity over minor units', () => {
    for (let i = 0; i < 2000; i++) {
      const cents = Math.floor((Math.random() - 0.5) * 2_000_000_000);
      const original = CENTS(cents);
      const roundTripped = M.fromDecimalString(M.toDecimalString(original), 'USD');
      expect(roundTripped.minorUnits).toBe(cents);
    }
  });

  it('renders the decimal form correctly around zero and sign boundaries', () => {
    expect(M.toDecimalString(CENTS(0))).toBe('0.00');
    expect(M.toDecimalString(CENTS(5))).toBe('0.05');
    expect(M.toDecimalString(CENTS(-5))).toBe('-0.05');
    expect(M.toDecimalString(CENTS(-100))).toBe('-1.00');
    expect(M.toDecimalString(CENTS(100))).toBe('1.00');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly where floats would not', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    const sum = M.add(M.fromDecimalString('0.10', 'USD'), M.fromDecimalString('0.20', 'USD'));
    expect(sum.minorUnits).toBe(30);
    expect(M.toDecimalString(sum)).toBe('0.30');
  });

  it('refuses to mix currencies', () => {
    expect(() => M.add(CENTS(100), M.money(100, 'EUR'))).toThrow(/Currency mismatch/);
    expect(() => M.compare(CENTS(100), M.money(100, 'GBP'))).toThrow(/Currency mismatch/);
  });

  it('sums a list exactly', () => {
    const values = Array.from({ length: 1000 }, () => CENTS(1));
    expect(M.sum(values, 'USD').minorUnits).toBe(1000);
  });

  it('multiplies by a ratio with half-away-from-zero rounding', () => {
    // The burden multiplier case: $120,000 × 1.30 = $156,000.
    const salary = M.fromDecimalString('120000.00', 'USD');
    expect(M.toDecimalString(M.multiply(salary, 1.3))).toBe('156000.00');
    expect(M.multiply(CENTS(5), 0.5).minorUnits).toBe(3);
    expect(M.multiply(CENTS(-5), 0.5).minorUnits).toBe(-3);
  });
});

describe('allocate — no lost or invented cents', () => {
  it('splits evenly when it divides cleanly', () => {
    const parts = M.allocate(CENTS(900), 3);
    expect(parts.map((p) => p.minorUnits)).toEqual([300, 300, 300]);
  });

  it('distributes the remainder rather than dropping it', () => {
    // $1.00 in three ways: naive division gives 33+33+33 = 99c, losing a cent.
    const parts = M.allocate(CENTS(100), 3);
    expect(parts.map((p) => p.minorUnits)).toEqual([34, 33, 33]);
  });

  it('parts always sum exactly to the original, for any amount and split', () => {
    for (let i = 0; i < 1000; i++) {
      const amount = Math.floor((Math.random() - 0.5) * 1_000_000);
      const parts = Math.floor(Math.random() * 12) + 1;
      const allocated = M.allocate(CENTS(amount), parts);
      expect(allocated).toHaveLength(parts);
      expect(M.sum(allocated, 'USD').minorUnits).toBe(amount);
    }
  });

  it('handles negative amounts without sign drift', () => {
    const parts = M.allocate(CENTS(-100), 3);
    expect(M.sum(parts, 'USD').minorUnits).toBe(-100);
    expect(parts.every((p) => p.minorUnits <= 0)).toBe(true);
  });

  it('rejects a non-positive split', () => {
    expect(() => M.allocate(CENTS(100), 0)).toThrow(M.MoneyError);
    expect(() => M.allocate(CENTS(100), 2.5)).toThrow(M.MoneyError);
  });
});

describe('comparison and formatting', () => {
  it('orders correctly', () => {
    expect(M.compare(CENTS(100), CENTS(200))).toBe(-1);
    expect(M.compare(CENTS(200), CENTS(100))).toBe(1);
    expect(M.compare(CENTS(100), CENTS(100))).toBe(0);
    expect(M.equals(CENTS(100), CENTS(100))).toBe(true);
    expect(M.equals(CENTS(100), M.money(100, 'EUR'))).toBe(false);
  });

  it('formats for display only', () => {
    expect(M.format(CENTS(1_420_000))).toBe('$14,200.00');
    expect(M.format(CENTS(-1_420_000))).toBe('-$14,200.00');
  });

  it('identifies zero and negative', () => {
    expect(M.isZero(M.zero('USD'))).toBe(true);
    expect(M.isNegative(CENTS(-1))).toBe(true);
    expect(M.isNegative(CENTS(0))).toBe(false);
  });
});
