/**
 * Value parsing for imported cells.
 *
 * Everything here is conservative: a value either parses to a number with a
 * clear rule, or it fails and the row is flagged. Nothing is rounded into a
 * different price, quantity or unit than the source shows.
 */
import { cleanCell } from './text';

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const CURRENCY = /(rs\.?|pkr|inr|usd|aed|sar|gbp|eur|\$|£|€|₹)/gi;

/** Strip currency tokens and spacing but keep digits and separators. */
function numericCore(raw: string): string {
  return cleanCell(raw)
    .replace(CURRENCY, ' ')
    .replace(/\/-?\s*$/, '')
    .replace(/[^\d.,()\-]/g, '')
    .trim();
}

/**
 * Parse a money cell to integer paisa.
 * Handles "Rs. 1,234.50", "1200", "1.234,50" (European), "(500)" (negative).
 */
export function parseMoney(raw: string): Parsed<number> {
  const text = cleanCell(raw);
  if (!text) return { ok: false, reason: 'empty' };
  const core = numericCore(text);
  if (!/\d/.test(core)) return { ok: false, reason: `"${text}" is not a number` };
  const negative = /^\(.*\)$/.test(core) || core.startsWith('-');
  let cleaned = core.replace(/[()]/g, '').replace(/-/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    normalized = cleaned.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    const parts = cleaned.split(',');
    const tail = parts[parts.length - 1];
    // "1,200" / "1,200,000" are thousands; "12,5" is a decimal comma.
    normalized = parts.length > 2 || tail.length === 3 ? parts.join('') : parts.join('.');
  } else if (lastDot >= 0) {
    const parts = cleaned.split('.');
    normalized = parts.length > 2 ? parts.join('') : cleaned;
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${text}" is not a readable amount` };
  return { ok: true, value: Math.round((negative ? -value : value) * 100) };
}

/** Quantity cells may carry a unit suffix ("12 pcs"); negatives are rejected. */
export function parseQuantity(raw: string): Parsed<number> {
  const text = cleanCell(raw);
  if (!text) return { ok: false, reason: 'empty' };
  const core = numericCore(text);
  if (!/\d/.test(core)) return { ok: false, reason: `"${text}" is not a quantity` };
  const cleaned = core.replace(/,/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${text}" is not a quantity` };
  if (value < 0) return { ok: false, reason: 'quantity cannot be negative' };
  return { ok: true, value: Math.round(value * 1000) / 1000 };
}

/** Tax rates are percentages: "17%", "17", "0". */
export function parseRate(raw: string): Parsed<number> {
  const text = cleanCell(raw);
  if (!text) return { ok: false, reason: 'empty' };
  const core = numericCore(text).replace(/,/g, '');
  const value = Number(core);
  if (!Number.isFinite(value)) return { ok: false, reason: `"${text}" is not a percentage` };
  if (value < 0 || value > 100) return { ok: false, reason: 'tax rate must be between 0 and 100' };
  return { ok: true, value };
}

/** Whole-number cells (reorder level, warranty months). */
export function parseCount(raw: string): Parsed<number> {
  const parsed = parseQuantity(raw);
  if (!parsed.ok) return parsed;
  if (!Number.isInteger(parsed.value)) return { ok: false, reason: 'must be a whole number' };
  return parsed;
}

/** Units used by the parts form; anything else is kept exactly as supplied. */
export const KNOWN_UNITS = ['pcs', 'litre', 'set', 'pair', 'kg', 'metre', 'box'];

export function normalizeUnit(raw: string): string {
  const text = cleanCell(raw).toLowerCase();
  if (!text) return '';
  const aliases: Record<string, string> = {
    pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', no: 'pcs', unit: 'pcs', units: 'pcs',
    l: 'litre', lt: 'litre', ltr: 'litre', litre: 'litre', liter: 'litre', litres: 'litre', liters: 'litre',
    set: 'set', sets: 'set', kit: 'set',
    pair: 'pair', pairs: 'pair', pr: 'pair',
    kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
    m: 'metre', mtr: 'metre', metre: 'metre', meter: 'metre', metres: 'metre', meters: 'metre',
    box: 'box', boxes: 'box', carton: 'box'
  };
  return aliases[text] ?? cleanCell(raw);
}

/** Codes and names are compared without punctuation or case differences. */
export function codeKey(raw: string): string {
  return cleanCell(raw).toUpperCase().replace(/\s+/g, '');
}

export function nameKey(name: string, category = '', brand = ''): string {
  const norm = (s: string) => cleanCell(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return [norm(name), norm(category), norm(brand)].join('|');
}
