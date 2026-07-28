/**
 * Money.
 *
 * The rule from docs/03-engineering/tech-stack.md §1: money is NEVER a plain
 * JavaScript number. Floating-point cents in a financial product is the bug that
 * ends companies, and it is invisible until it isn't.
 *
 * Representation: integer minor units (cents for USD) in a branded type, plus an
 * explicit currency. The brand means you cannot pass a raw `number` where a
 * `MinorUnits` is expected — the compiler stops the class of bug where a dollar
 * amount is treated as cents or vice versa.
 */

declare const MinorUnitsBrand: unique symbol;

/** An integer count of a currency's smallest unit (e.g. US cents). */
export type MinorUnits = number & { readonly [MinorUnitsBrand]: true };

/** ISO-4217 alphabetic code. Kept as a string union at the boundary we support. */
export type CurrencyCode = 'USD' | 'CAD' | 'GBP' | 'EUR' | 'AUD';

export interface Money {
  readonly minorUnits: MinorUnits;
  readonly currency: CurrencyCode;
}

/** Minor units per major unit. All currently supported currencies use 2. */
const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  USD: 2,
  CAD: 2,
  GBP: 2,
  EUR: 2,
  AUD: 2,
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Assert-and-brand an integer as minor units. */
export function minorUnits(value: number): MinorUnits {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Minor units must be an integer, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Minor units outside safe integer range: ${value}`);
  }
  return value as MinorUnits;
}

export function money(value: number, currency: CurrencyCode): Money {
  return { minorUnits: minorUnits(value), currency };
}

export const zero = (currency: CurrencyCode): Money => money(0, currency);

/**
 * Parse a decimal string ("14200.0000", "-1234.56") into Money.
 *
 * Deliberately string-based rather than parseFloat: the whole point is to never
 * let a decimal value pass through a binary float. Postgres NUMERIC arrives as a
 * string from node-postgres, so this is the primary ingress path.
 */
export function fromDecimalString(input: string, currency: CurrencyCode): Money {
  const trimmed = input.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`Not a valid decimal amount: "${input}"`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  const exponent = MINOR_UNIT_EXPONENT[currency];

  const padded = fraction.padEnd(exponent, '0');
  const kept = padded.slice(0, exponent);
  const dropped = padded.slice(exponent);

  // Refuse to silently truncate real precision. A caller that means to round
  // must say so via `roundToMinorUnits`.
  if (/[1-9]/.test(dropped)) {
    throw new MoneyError(
      `"${input}" has more precision than ${currency} supports; use roundToMinorUnits to round explicitly`,
    );
  }

  const magnitude = BigInt(whole) * BigInt(10 ** exponent) + BigInt(kept || '0');
  const signed = sign === '-' ? -magnitude : magnitude;

  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`Amount outside safe integer range: "${input}"`);
  }
  return { minorUnits: minorUnits(Number(signed)), currency };
}

/** Round a decimal string to the currency's precision, half-away-from-zero. */
export function roundToMinorUnits(input: string, currency: CurrencyCode): Money {
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const asNumber = Number(input);
  if (!Number.isFinite(asNumber)) {
    throw new MoneyError(`Not a valid decimal amount: "${input}"`);
  }
  const scaled = asNumber * 10 ** exponent;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return { minorUnits: minorUnits(rounded), currency };
}

/** Render as a decimal string suitable for a NUMERIC column or an API response. */
export function toDecimalString(value: Money): string {
  const exponent = MINOR_UNIT_EXPONENT[value.currency];
  const negative = value.minorUnits < 0;
  const digits = Math.abs(value.minorUnits).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minorUnits + b.minorUnits, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minorUnits - b.minorUnits, a.currency);
}

export function negate(a: Money): Money {
  // `0 - x` rather than `-x`: the branded type is not directly negatable, and
  // going through the constructor keeps the integer invariant checked.
  return money(0 - (a.minorUnits as number), a.currency);
}

export function sum(values: readonly Money[], currency: CurrencyCode): Money {
  return values.reduce<Money>((acc, v) => add(acc, v), zero(currency));
}

/** Multiply by a ratio (e.g. a 1.30 burden multiplier), rounding half-away-from-zero. */
export function multiply(value: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`Multiplier must be finite, received ${factor}`);
  }
  const scaled = value.minorUnits * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return money(rounded, value.currency);
}

/**
 * Split into n parts with no lost or invented cents.
 *
 * Naive division loses remainder cents, which is how allocation bugs reach the
 * general ledger. The remainder is distributed one minor unit at a time across
 * the leading parts, so the parts always sum exactly to the input.
 */
export function allocate(value: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Parts must be a positive integer, received ${parts}`);
  }
  const sign = value.minorUnits < 0 ? -1 : 1;
  const magnitude = Math.abs(value.minorUnits);
  const base = Math.floor(magnitude / parts);
  const remainder = magnitude - base * parts;

  return Array.from({ length: parts }, (_, i) =>
    money(sign * (base + (i < remainder ? 1 : 0)), value.currency),
  );
}

export const isZero = (v: Money): boolean => v.minorUnits === 0;
export const isNegative = (v: Money): boolean => v.minorUnits < 0;

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minorUnits < b.minorUnits ? -1 : a.minorUnits > b.minorUnits ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minorUnits === b.minorUnits;
}

/** Human-readable formatting. Presentation only — never parse this back. */
export function format(value: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
  }).format(value.minorUnits / 10 ** MINOR_UNIT_EXPONENT[value.currency]);
}
