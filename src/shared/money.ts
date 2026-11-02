/**
 * Decimal-safe monetary and quantity arithmetic.
 *
 * Storage conventions (used everywhere in DB and IPC):
 *  - Money is stored as INTEGER centimes (1 DH = 100 centimes).
 *  - Quantities are stored as INTEGER milli-units of the product unit
 *    (1 kg = 1000 milli-kg, 1 pc = 1000 milli-pc). This gives 3-decimal precision.
 *
 * All conversions go through decimal.js to avoid binary floating point errors.
 */
import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export const QTY_SCALE = 1000
export const MONEY_SCALE = 100

/** Converts a decimal DH amount (number or string, e.g. "12.50") to centimes. */
export function toCents(amount: number | string): number {
  if (amount === '' || amount === null || amount === undefined) return 0
  const cleaned = String(amount).trim().replace(/\s+/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error('INVALID_AMOUNT')
  const d = new Decimal(cleaned)
  return d.mul(MONEY_SCALE).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}

/** Converts centimes to a decimal number of DH (for display / inputs only). */
export function fromCents(cents: number): number {
  return new Decimal(cents).div(MONEY_SCALE).toNumber()
}

/** Converts a decimal quantity (e.g. "0.350") to milli-units. */
export function toMilli(qty: number | string): number {
  if (qty === '' || qty === null || qty === undefined) return 0
  const cleaned = String(qty).trim().replace(/\s+/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error('INVALID_QUANTITY')
  const d = new Decimal(cleaned)
  return d.mul(QTY_SCALE).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}

/** Converts milli-units to a decimal quantity. */
export function fromMilli(milli: number): number {
  return new Decimal(milli).div(QTY_SCALE).toNumber()
}

/**
 * Line amount = quantity × unit price, rounded half-up to the centime.
 * @param qtyMilli quantity in milli-units of the product unit
 * @param unitPriceCents price per 1 product unit in centimes
 */
export function lineAmount(qtyMilli: number, unitPriceCents: number): number {
  return new Decimal(qtyMilli)
    .mul(unitPriceCents)
    .div(QTY_SCALE)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber()
}

/** Percentage of an amount in centimes, rounded to the centime. percent may have decimals (e.g. 2.5). */
export function percentOf(amountCents: number, percent: number): number {
  return new Decimal(amountCents)
    .mul(percent)
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber()
}

/** Sum integers safely (all values are integer centimes or milli-units). */
export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * Weighted average cost after receiving new stock.
 * Negative or zero existing stock contributes nothing to the average.
 */
export function weightedAverageCost(
  currentQtyMilli: number,
  currentCostCents: number,
  addedQtyMilli: number,
  addedCostCents: number
): number {
  const curQ = Math.max(0, currentQtyMilli)
  const totalQ = curQ + addedQtyMilli
  if (totalQ <= 0) return addedCostCents
  return new Decimal(curQ)
    .mul(currentCostCents)
    .plus(new Decimal(addedQtyMilli).mul(addedCostCents))
    .div(totalQ)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber()
}

/** Formats centimes for display, e.g. 12350 -> "123,50 DH". */
export function formatMoney(cents: number, lang: 'fr' | 'ar' = 'fr', symbol?: string): string {
  const value = new Decimal(cents).div(MONEY_SCALE).toNumber()
  const formatted = new Intl.NumberFormat('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
  const sym = symbol ?? (lang === 'ar' ? 'د.م.' : 'DH')
  return `${formatted} ${sym}`
}

/** Formats a milli-unit quantity with up to 3 decimals. */
export function formatQty(milli: number, decimals = 3): string {
  const value = new Decimal(milli).div(QTY_SCALE).toNumber()
  return new Intl.NumberFormat('fr-MA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(value)
}

