/**
 * Pure cart calculation shared by renderer (live preview) and main (authoritative).
 * All amounts are integer centimes, quantities integer milli-units.
 */
import Decimal from 'decimal.js'
import { lineAmount, percentOf } from './money'

export type DiscountType = 'amount' | 'percent'
export interface Discount {
  type: DiscountType
  /** For 'amount': centimes. For 'percent': percentage (e.g. 10 or 2.5). */
  value: number
}

export interface CartLineInput {
  qtyMilli: number
  unitPriceCents: number
  discount?: Discount | null
}

export interface CartLineResult {
  grossCents: number
  lineDiscountCents: number
  cartDiscountShareCents: number
  totalCents: number
}

export interface CartResult {
  lines: CartLineResult[]
  grossCents: number
  linesDiscountCents: number
  subtotalCents: number // after line discounts, before cart discount
  cartDiscountCents: number
  totalCents: number
  totalDiscountCents: number
}

function discountAmount(base: number, d?: Discount | null): number {
  if (!d || !d.value || d.value <= 0) return 0
  const raw = d.type === 'percent' ? percentOf(base, Math.min(d.value, 100)) : Math.round(d.value)
  return Math.max(0, Math.min(raw, base))
}

export function computeCart(lines: CartLineInput[], cartDiscount?: Discount | null): CartResult {
  const partial = lines.map((l) => {
    const gross = lineAmount(l.qtyMilli, l.unitPriceCents)
    const ld = discountAmount(gross, l.discount)
    return { gross, ld, net: gross - ld }
  })
  const grossCents = partial.reduce((a, p) => a + p.gross, 0)
  const linesDiscountCents = partial.reduce((a, p) => a + p.ld, 0)
  const subtotalCents = grossCents - linesDiscountCents
  const cartDiscountCents = discountAmount(subtotalCents, cartDiscount)

  // Allocate the cart discount proportionally to line net amounts (largest remainder method)
  const shares = partial.map(() => 0)
  if (cartDiscountCents > 0 && subtotalCents > 0) {
    const exact = partial.map((p) => new Decimal(p.net).mul(cartDiscountCents).div(subtotalCents))
    const floors = exact.map((e) => e.floor().toNumber())
    let remainder = cartDiscountCents - floors.reduce((a, b) => a + b, 0)
    const order = exact
      .map((e, i) => ({ i, frac: e.minus(e.floor()).toNumber() }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
    for (const o of order) {
      if (remainder <= 0) break
      floors[o.i] += 1
      remainder--
    }
    floors.forEach((f, i) => (shares[i] = f))
  }

  const resultLines = partial.map((p, i) => ({
    grossCents: p.gross,
    lineDiscountCents: p.ld,
    cartDiscountShareCents: shares[i],
    totalCents: p.net - shares[i]
  }))
  const totalCents = subtotalCents - cartDiscountCents
  return {
    lines: resultLines,
    grossCents,
    linesDiscountCents,
    subtotalCents,
    cartDiscountCents,
    totalCents,
    totalDiscountCents: linesDiscountCents + cartDiscountCents
  }
}

export interface PaymentInput {
  method: string
  amountCents: number
}

export interface PaymentAllocation {
  /** Applied payment rows (cash reduced to the amount actually kept). */
  applied: PaymentInput[]
  paidCents: number
  creditCents: number
  tenderedCents: number
  changeCents: number
}

/**
 * Allocates payments against a total. Non-cash payments cannot exceed the total.
 * Cash may exceed the remaining amount: the excess is returned as change.
 */
export function allocatePayments(totalCents: number, payments: PaymentInput[], cashMethods: string[]): PaymentAllocation {
  const clean = payments.filter((p) => p.amountCents > 0)
  const nonCash = clean.filter((p) => !cashMethods.includes(p.method))
  const cash = clean.filter((p) => cashMethods.includes(p.method))
  const nonCashTotal = nonCash.reduce((a, p) => a + p.amountCents, 0)
  if (nonCashTotal > totalCents) throw new Error('PAYMENT_EXCEEDS_TOTAL')
  const cashTendered = cash.reduce((a, p) => a + p.amountCents, 0)
  const cashApplied = Math.min(cashTendered, totalCents - nonCashTotal)
  const changeCents = cashTendered - cashApplied
  const applied: PaymentInput[] = [...nonCash]
  // Merge cash rows per method, keeping the applied amount.
  let toApply = cashApplied
  for (const c of cash) {
    if (toApply <= 0) break
    const a = Math.min(c.amountCents, toApply)
    applied.push({ method: c.method, amountCents: a })
    toApply -= a
  }
  const paidCents = nonCashTotal + cashApplied
  return {
    applied,
    paidCents,
    creditCents: totalCents - paidCents,
    tenderedCents: nonCashTotal + cashTendered,
    changeCents
  }
}

