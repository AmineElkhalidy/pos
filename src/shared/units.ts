/**
 * Measurement units and decimal-safe conversions.
 * Each unit belongs to a dimension; conversion is only possible within the same dimension.
 * `factor` is the number of base units (g, ml, pc) contained in one unit.
 */
import Decimal from 'decimal.js'
import { QTY_SCALE } from './money'

export type UnitDimension = 'count' | 'mass' | 'volume'
export type UnitCode = 'pc' | 'kg' | 'g' | 'L' | 'ml' | 'pack' | 'box'

export interface UnitDef {
  code: UnitCode
  dimension: UnitDimension
  factor: number
  decimals: number
  nameFr: string
  nameAr: string
}

export const UNITS: Record<UnitCode, UnitDef> = {
  pc: { code: 'pc', dimension: 'count', factor: 1, decimals: 0, nameFr: 'Pièce', nameAr: 'قطعة' },
  pack: { code: 'pack', dimension: 'count', factor: 1, decimals: 0, nameFr: 'Paquet', nameAr: 'علبة' },
  box: { code: 'box', dimension: 'count', factor: 1, decimals: 0, nameFr: 'Carton', nameAr: 'صندوق' },
  kg: { code: 'kg', dimension: 'mass', factor: 1000, decimals: 3, nameFr: 'Kilogramme', nameAr: 'كيلوغرام' },
  g: { code: 'g', dimension: 'mass', factor: 1, decimals: 0, nameFr: 'Gramme', nameAr: 'غرام' },
  L: { code: 'L', dimension: 'volume', factor: 1000, decimals: 3, nameFr: 'Litre', nameAr: 'لتر' },
  ml: { code: 'ml', dimension: 'volume', factor: 1, decimals: 0, nameFr: 'Millilitre', nameAr: 'مليلتر' }
}

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[]

export function isUnitCode(v: string): v is UnitCode {
  return v in UNITS
}

/** Units the cashier can use to enter a quantity for a product sold in `productUnit`. */
export function compatibleUnits(productUnit: UnitCode): UnitCode[] {
  const def = UNITS[productUnit]
  if (def.dimension === 'count') return [productUnit]
  return UNIT_CODES.filter((u) => UNITS[u].dimension === def.dimension)
}

export function canConvert(from: UnitCode, to: UnitCode): boolean {
  if (from === to) return true
  const a = UNITS[from]
  const b = UNITS[to]
  return a.dimension === b.dimension && a.dimension !== 'count'
}

/** Converts a decimal quantity between units (returns decimal string-safe number). */
export function convertQty(qty: number | string, from: UnitCode, to: UnitCode): number {
  if (!canConvert(from, to)) throw new Error(`UNIT_INCOMPATIBLE:${from}->${to}`)
  return new Decimal(String(qty)).mul(UNITS[from].factor).div(UNITS[to].factor).toNumber()
}

/** Converts a quantity entered in `entryUnit` to milli-units of `productUnit`. */
export function toProductMilli(qty: number | string, entryUnit: UnitCode, productUnit: UnitCode): number {
  if (!canConvert(entryUnit, productUnit)) throw new Error(`UNIT_INCOMPATIBLE:${entryUnit}->${productUnit}`)
  return new Decimal(String(qty).replace(',', '.'))
    .mul(UNITS[entryUnit].factor)
    .div(UNITS[productUnit].factor)
    .mul(QTY_SCALE)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber()
}

/** Whether products in this unit are typically sold with decimal quantities (weight / volume). */
export function isMeasuredUnit(unit: UnitCode): boolean {
  return UNITS[unit].dimension !== 'count'
}

