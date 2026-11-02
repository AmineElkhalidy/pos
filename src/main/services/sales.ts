import { z } from 'zod'
import type { DB } from '../db/connection'
import { AppError, audit, getSettings, hasPerm, likeTerm, nextSequence, nowIso, type Ctx } from './common'
import { applyStockMovement } from './stock'
import { getCustomerBalance } from './partners'
import { cashMethodCodes, getOpenSession, sessionIdForCash, isCashMethod } from './cash'
import { allocatePayments, computeCart, type Discount } from '@shared/cart'
import { lineAmount, percentOf, toCents } from '@shared/money'
import { compatibleUnits, toProductMilli, type UnitCode } from '@shared/units'
import Decimal from 'decimal.js'

const decimalInput = z.union([z.string(), z.number()])
const discountSchema = z
  .object({ type: z.enum(['amount', 'percent']), value: decimalInput })
  .nullable()
  .optional()

export const saleInputSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: decimalInput,
        entryUnit: z.string().optional(),
        unitPrice: decimalInput.optional().nullable(),
        discount: discountSchema
      })
    )
    .min(1),
  cartDiscount: discountSchema,
  customerId: z.number().int().positive().nullable().optional(),
  payments: z.array(z.object({ method: z.string().min(1), amount: decimalInput })).default([]),
  notes: z.string().max(500).optional().nullable()
})

export type SaleInput = z.input<typeof saleInputSchema>

function toDiscount(d: { type: 'amount' | 'percent'; value: string | number } | null | undefined): Discount | null {
  if (!d) return null
  const v = d.type === 'amount' ? toCents(d.value) : new Decimal(String(d.value).replace(',', '.')).toNumber()
  if (!(v > 0)) return null
  if (d.type === 'percent' && v > 100) throw new AppError('INVALID_DISCOUNT')
  return { type: d.type, value: v }
}

/**
 * Completes a sale atomically: invoice number, items with cost snapshot, stock movements,
 * payments and customer credit. Any error rolls back everything.
 */
export function createSale(ctx: Ctx, raw: unknown) {
  const input = saleInputSchema.parse(raw)
  const db = ctx.db
  if (!hasPerm(ctx.user, 'pos.sell')) throw new AppError('FORBIDDEN', { permission: 'pos.sell' })
  const settings = getSettings(db)
  const isAdmin = ctx.user.role === 'ADMIN'

  const run = db.transaction(() => {
    // ---- cash session
    const session = getOpenSession(db, ctx.user.id)
    if (settings.sales.requireCashSession && !session) throw new AppError('NO_OPEN_SESSION')

    // ---- resolve lines from DB (prices are authoritative from DB unless overridden with permission)
    const lines = input.items.map((it) => {
      const p = db
        .prepare(
          'SELECT id, name_fr, name_ar, unit_code, sale_price_cents, min_sale_price_cents, avg_cost_cents, active, archived FROM products WHERE id = ?'
        )
        .get(it.productId) as
        | {
            id: number
            name_fr: string
            name_ar: string | null
            unit_code: UnitCode
            sale_price_cents: number
            min_sale_price_cents: number | null
            avg_cost_cents: number
            active: number
            archived: number
          }
        | undefined
      if (!p) throw new AppError('PRODUCT_NOT_FOUND')
      if (!p.active || p.archived) throw new AppError('PRODUCT_INACTIVE', { product: p.name_fr })
      const entryUnit = (it.entryUnit ?? p.unit_code) as UnitCode
      if (!compatibleUnits(p.unit_code).includes(entryUnit)) throw new AppError('UNIT_INCOMPATIBLE', { product: p.name_fr })
      const qtyMilli = toProductMilli(it.qty, entryUnit, p.unit_code)
      if (!(qtyMilli > 0)) throw new AppError('INVALID_QUANTITY', { product: p.name_fr })
      let unitPrice = p.sale_price_cents
      if (it.unitPrice !== undefined && it.unitPrice !== null && it.unitPrice !== '') {
        const override = toCents(it.unitPrice)
        if (override !== p.sale_price_cents) {
          if (!hasPerm(ctx.user, 'pos.price_override')) throw new AppError('FORBIDDEN', { permission: 'pos.price_override' })
          if (override < 0) throw new AppError('INVALID_PRICE')
          unitPrice = override
        }
      }
      return { p, entryUnit, entryQty: String(it.qty), qtyMilli, unitPrice, discount: toDiscount(it.discount) }
    })

    const cartDiscount = toDiscount(input.cartDiscount)
    const cart = computeCart(
      lines.map((l) => ({ qtyMilli: l.qtyMilli, unitPriceCents: l.unitPrice, discount: l.discount })),
      cartDiscount
    )

    // ---- discount authorization
    if (cart.totalDiscountCents > 0) {
      if (!hasPerm(ctx.user, 'pos.discount')) throw new AppError('FORBIDDEN', { permission: 'pos.discount' })
      if (!isAdmin && cart.grossCents > 0) {
        const maxAllowed = percentOf(cart.grossCents, settings.sales.maxCashierDiscountPercent)
        if (cart.totalDiscountCents > maxAllowed)
          throw new AppError('DISCOUNT_EXCEEDS_LIMIT', { max: settings.sales.maxCashierDiscountPercent })
      }
    }
    // ---- minimum selling price (net of discounts)
    if (settings.sales.enforceMinPrice && !isAdmin) {
      lines.forEach((l, i) => {
        if (l.p.min_sale_price_cents !== null) {
          const minTotal = lineAmount(l.qtyMilli, l.p.min_sale_price_cents)
          if (cart.lines[i].totalCents < minTotal) throw new AppError('BELOW_MIN_PRICE', { product: l.p.name_fr })
        }
      })
    }

    // ---- payments
    const methods = new Set(
      (db.prepare('SELECT code FROM payment_methods WHERE active = 1').all() as { code: string }[]).map((r) => r.code)
    )
    const payments = input.payments.map((p) => {
      if (!methods.has(p.method)) throw new AppError('INVALID_PAYMENT_METHOD', { method: p.method })
      const amountCents = toCents(p.amount)
      if (amountCents < 0) throw new AppError('INVALID_AMOUNT')
      return { method: p.method, amountCents }
    })
    let alloc
    try {
      alloc = allocatePayments(cart.totalCents, payments, cashMethodCodes(db))
    } catch (e) {
      throw new AppError((e as Error).message)
    }

    // ---- credit
    const customerId = input.customerId ?? null
    if (customerId) {
      const c = db.prepare('SELECT id, active, credit_limit_cents FROM customers WHERE id = ?').get(customerId) as
        | { id: number; active: number; credit_limit_cents: number | null }
        | undefined
      if (!c || !c.active) throw new AppError('CUSTOMER_NOT_FOUND')
      if (alloc.creditCents > 0) {
        if (!settings.sales.allowCreditSales) throw new AppError('CREDIT_DISABLED')
        if (!hasPerm(ctx.user, 'pos.credit_sale')) throw new AppError('FORBIDDEN', { permission: 'pos.credit_sale' })
        const limit = c.credit_limit_cents ?? settings.sales.defaultCreditLimitCents
        if (limit !== null && settings.sales.blockOverCreditLimit) {
          const balance = getCustomerBalance(db, customerId)
          if (balance + alloc.creditCents > limit)
            throw new AppError('CREDIT_LIMIT_EXCEEDED', { limit, balance, requested: alloc.creditCents })
        }
      }
    } else if (alloc.creditCents > 0) {
      throw new AppError('PAYMENT_INSUFFICIENT')
    }

    // ---- persist sale
    const now = nowIso()
    const seq = nextSequence(db, 'invoice')
    const invoiceNo = `${settings.sales.invoicePrefix}${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
    const costTotal = lines.reduce((a, l) => a + lineAmount(l.qtyMilli, l.p.avg_cost_cents), 0)
    const saleRes = db
      .prepare(
        `INSERT INTO sales (invoice_no, created_at, user_id, customer_id, session_id, subtotal_cents, lines_discount_cents,
          cart_discount_cents, total_cents, paid_cents, credit_cents, tendered_cents, change_cents, cost_cents, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
      )
      .run(
        invoiceNo,
        now,
        ctx.user.id,
        customerId,
        session?.id ?? null,
        cart.grossCents,
        cart.linesDiscountCents,
        cart.cartDiscountCents,
        cart.totalCents,
        alloc.paidCents,
        alloc.creditCents,
        alloc.tenderedCents,
        alloc.changeCents,
        costTotal,
        input.notes ?? null
      )
    const saleId = Number(saleRes.lastInsertRowid)
    const insItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name, unit_code, qty_milli, entry_qty, entry_unit, unit_price_cents,
        gross_cents, discount_cents, total_cents, unit_cost_cents, cost_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    lines.forEach((l, i) => {
      const r = cart.lines[i]
      const cost = lineAmount(l.qtyMilli, l.p.avg_cost_cents)
      insItem.run(
        saleId,
        l.p.id,
        l.p.name_fr,
        l.p.unit_code,
        l.qtyMilli,
        l.entryQty,
        l.entryUnit,
        l.unitPrice,
        r.grossCents,
        r.lineDiscountCents + r.cartDiscountShareCents,
        r.totalCents,
        l.p.avg_cost_cents,
        cost
      )
      applyStockMovement(db, {
        productId: l.p.id,
        type: 'SALE',
        qtyMilli: -l.qtyMilli,
        unitCostCents: l.p.avg_cost_cents,
        refType: 'sale',
        refId: saleId,
        note: invoiceNo,
        userId: ctx.user.id
      })
    })
    const insPay = db.prepare('INSERT INTO sale_payments (sale_id, method_code, amount_cents, created_at) VALUES (?, ?, ?, ?)')
    for (const p of alloc.applied) if (p.amountCents > 0) insPay.run(saleId, p.method, p.amountCents, now)

    if (cart.totalDiscountCents > 0) {
      audit(db, ctx.user.id, 'SALE_DISCOUNT', 'sale', saleId, { invoiceNo, discountCents: cart.totalDiscountCents })
    }
    audit(db, ctx.user.id, 'SALE_COMPLETED', 'sale', saleId, { invoiceNo, totalCents: cart.totalCents, creditCents: alloc.creditCents })
    return saleId
  })

  const saleId = run.immediate()
  return getSale(db, saleId)
}

export interface SaleDetail {
  id: number
  invoiceNo: string
  createdAt: string
  userId: number
  userName: string
  customerId: number | null
  customerName: string | null
  customerPhone: string | null
  sessionId: number | null
  subtotalCents: number
  linesDiscountCents: number
  cartDiscountCents: number
  totalCents: number
  paidCents: number
  creditCents: number
  tenderedCents: number
  changeCents: number
  costCents: number
  returnedCents: number
  status: 'completed' | 'partially_returned' | 'returned'
  notes: string | null
  customerBalanceCents: number | null
  items: {
    id: number
    productId: number
    productName: string
    productNameAr: string | null
    unitCode: UnitCode
    qtyMilli: number
    entryQty: string | null
    entryUnit: string | null
    unitPriceCents: number
    grossCents: number
    discountCents: number
    totalCents: number
    unitCostCents: number
    costCents: number
    returnedMilli: number
  }[]
  payments: { method: string; nameFr: string; nameAr: string; amountCents: number }[]
}

export function getSale(db: DB, id: number): SaleDetail {
  const s = db
    .prepare(
      `SELECT s.id, s.invoice_no AS invoiceNo, s.created_at AS createdAt, s.user_id AS userId, u.full_name AS userName,
        s.customer_id AS customerId, c.name AS customerName, c.phone AS customerPhone, s.session_id AS sessionId,
        s.subtotal_cents AS subtotalCents, s.lines_discount_cents AS linesDiscountCents, s.cart_discount_cents AS cartDiscountCents,
        s.total_cents AS totalCents, s.paid_cents AS paidCents, s.credit_cents AS creditCents, s.tendered_cents AS tenderedCents,
        s.change_cents AS changeCents, s.cost_cents AS costCents, s.returned_cents AS returnedCents, s.status, s.notes
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`
    )
    .get(id) as Omit<SaleDetail, 'items' | 'payments' | 'customerBalanceCents'> | undefined
  if (!s) throw new AppError('SALE_NOT_FOUND')
  const items = db
    .prepare(
      `SELECT si.id, si.product_id AS productId, si.product_name AS productName, p.name_ar AS productNameAr, si.unit_code AS unitCode,
        si.qty_milli AS qtyMilli, si.entry_qty AS entryQty, si.entry_unit AS entryUnit, si.unit_price_cents AS unitPriceCents,
        si.gross_cents AS grossCents, si.discount_cents AS discountCents, si.total_cents AS totalCents,
        si.unit_cost_cents AS unitCostCents, si.cost_cents AS costCents, si.returned_milli AS returnedMilli
       FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`
    )
    .all(id) as SaleDetail['items']
  const payments = db
    .prepare(
      `SELECT sp.method_code AS method, pm.name_fr AS nameFr, pm.name_ar AS nameAr, sp.amount_cents AS amountCents
       FROM sale_payments sp JOIN payment_methods pm ON pm.code = sp.method_code WHERE sp.sale_id = ? ORDER BY sp.id`
    )
    .all(id) as SaleDetail['payments']
  const customerBalanceCents = s.customerId ? getCustomerBalance(db, s.customerId) : null
  return { ...s, items, payments, customerBalanceCents }
}

export function listSales(
  db: DB,
  opts: { from?: string; to?: string; userId?: number; customerId?: number; search?: string; limit?: number; onlyCredit?: boolean }
) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.from) {
    where.push('s.created_at >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('s.created_at < ?')
    params.push(opts.to)
  }
  if (opts.userId) {
    where.push('s.user_id = ?')
    params.push(opts.userId)
  }
  if (opts.customerId) {
    where.push('s.customer_id = ?')
    params.push(opts.customerId)
  }
  if (opts.onlyCredit) where.push('s.credit_cents > 0')
  if (opts.search?.trim()) {
    const t = likeTerm(opts.search.trim())
    where.push("(s.invoice_no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')")
    params.push(t, t)
  }
  params.push(Math.min(opts.limit ?? 300, 5000))
  return db
    .prepare(
      `SELECT s.id, s.invoice_no AS invoiceNo, s.created_at AS createdAt, u.full_name AS userName, c.name AS customerName,
        s.total_cents AS totalCents, s.paid_cents AS paidCents, s.credit_cents AS creditCents, s.returned_cents AS returnedCents,
        s.cost_cents AS costCents, s.status,
        (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS itemCount,
        (SELECT GROUP_CONCAT(DISTINCT sp.method_code) FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY s.id DESC LIMIT ?`
    )
    .all(...params) as {
    id: number
    invoiceNo: string
    createdAt: string
    userName: string
    customerName: string | null
    totalCents: number
    paidCents: number
    creditCents: number
    returnedCents: number
    costCents: number
    status: string
    itemCount: number
    methods: string | null
  }[]
}

// ======================= Returns =======================

export const returnInputSchema = z.object({
  saleId: z.number().int().positive(),
  items: z.array(z.object({ saleItemId: z.number().int().positive(), qty: decimalInput })).min(1),
  reason: z.string().max(300).optional().nullable()
})

/**
 * Returns items from a sale. Refund goes first to reducing the remaining customer debt on
 * this sale (if any), the rest is refunded in cash (recorded in the current cash session).
 */
export function createSaleReturn(ctx: Ctx, raw: unknown) {
  const input = returnInputSchema.parse(raw)
  const db = ctx.db
  if (!hasPerm(ctx.user, 'pos.return')) throw new AppError('FORBIDDEN', { permission: 'pos.return' })
  return db
    .transaction(() => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(input.saleId) as
        | { id: number; invoice_no: string; customer_id: number | null; credit_cents: number; total_cents: number; returned_cents: number }
        | undefined
      if (!sale) throw new AppError('SALE_NOT_FOUND')
      const now = nowIso()
      const seq = nextSequence(db, 'return')
      const returnNo = `R${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
      const sessionId = sessionIdForCash(db, ctx.user.id)
      const r = db
        .prepare(
          `INSERT INTO sale_returns (return_no, sale_id, created_at, user_id, session_id, total_cents, reason) VALUES (?, ?, ?, ?, ?, 0, ?)`
        )
        .run(returnNo, sale.id, now, ctx.user.id, sessionId, input.reason ?? null)
      const returnId = Number(r.lastInsertRowid)
      let total = 0
      let cost = 0
      for (const it of input.items) {
        const si = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(it.saleItemId, sale.id) as
          | {
              id: number
              product_id: number
              unit_code: UnitCode
              qty_milli: number
              returned_milli: number
              total_cents: number
              cost_cents: number
              unit_cost_cents: number
              product_name: string
            }
          | undefined
        if (!si) throw new AppError('NOT_FOUND')
        const qtyMilli = toProductMilli(it.qty, si.unit_code, si.unit_code)
        if (qtyMilli <= 0) throw new AppError('INVALID_QUANTITY')
        if (qtyMilli > si.qty_milli - si.returned_milli) throw new AppError('RETURN_EXCEEDS_SOLD', { product: si.product_name })
        // Proportional amount; the last unit returned gets the exact remainder to avoid rounding drift.
        const isFinal = qtyMilli === si.qty_milli - si.returned_milli
        const alreadyAmt = (
          db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS a, COALESCE(SUM(cost_cents),0) AS c FROM sale_return_items WHERE sale_item_id = ?').get(si.id) as {
            a: number
            c: number
          }
        )
        const amount = isFinal
          ? si.total_cents - alreadyAmt.a
          : new Decimal(si.total_cents).mul(qtyMilli).div(si.qty_milli).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
        const itemCost = isFinal
          ? si.cost_cents - alreadyAmt.c
          : new Decimal(si.cost_cents).mul(qtyMilli).div(si.qty_milli).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
        db.prepare(
          'INSERT INTO sale_return_items (return_id, sale_item_id, product_id, qty_milli, amount_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(returnId, si.id, si.product_id, qtyMilli, amount, itemCost)
        db.prepare('UPDATE sale_items SET returned_milli = returned_milli + ? WHERE id = ?').run(qtyMilli, si.id)
        applyStockMovement(db, {
          productId: si.product_id,
          type: 'SALE_RETURN',
          qtyMilli,
          unitCostCents: si.unit_cost_cents,
          updateAverageCost: true,
          refType: 'sale_return',
          refId: returnId,
          note: `${returnNo} / ${sale.invoice_no}`,
          userId: ctx.user.id
        })
        total += amount
        cost += itemCost
      }
      // Debt reduction limited to the credit still attributable to this sale.
      const prevDebtReduction = (
        db.prepare('SELECT COALESCE(SUM(debt_reduction_cents),0) AS v FROM sale_returns WHERE sale_id = ?').get(sale.id) as { v: number }
      ).v
      let debtReduction = 0
      if (sale.customer_id && sale.credit_cents > 0) {
        const remainingSaleCredit = sale.credit_cents - prevDebtReduction
        const currentBalance = getCustomerBalance(db, sale.customer_id)
        debtReduction = Math.max(0, Math.min(total, remainingSaleCredit, currentBalance))
      }
      const cashRefund = total - debtReduction
      if (cashRefund > 0 && getSettings(db).sales.requireCashSession && !sessionId) throw new AppError('NO_OPEN_SESSION')
      db.prepare('UPDATE sale_returns SET total_cents = ?, cash_refund_cents = ?, debt_reduction_cents = ?, cost_cents = ? WHERE id = ?').run(
        total,
        cashRefund,
        debtReduction,
        cost,
        returnId
      )
      const newReturned = sale.returned_cents + total
      const remaining = (
        db.prepare('SELECT COALESCE(SUM(qty_milli - returned_milli),0) AS v FROM sale_items WHERE sale_id = ?').get(sale.id) as { v: number }
      ).v
      db.prepare('UPDATE sales SET returned_cents = ?, status = ? WHERE id = ?').run(
        newReturned,
        remaining === 0 ? 'returned' : 'partially_returned',
        sale.id
      )
      audit(db, ctx.user.id, 'SALE_RETURN', 'sale', sale.id, { returnNo, totalCents: total, cashRefund, debtReduction })
      return { returnId, returnNo, totalCents: total, cashRefundCents: cashRefund, debtReductionCents: debtReduction }
    })
    .immediate()
}

export function listReturns(db: DB, opts: { from?: string; to?: string; saleId?: number }) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.from) {
    where.push('r.created_at >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('r.created_at < ?')
    params.push(opts.to)
  }
  if (opts.saleId) {
    where.push('r.sale_id = ?')
    params.push(opts.saleId)
  }
  return db
    .prepare(
      `SELECT r.id, r.return_no AS returnNo, r.sale_id AS saleId, s.invoice_no AS invoiceNo, r.created_at AS createdAt,
        u.full_name AS userName, r.total_cents AS totalCents, r.cash_refund_cents AS cashRefundCents,
        r.debt_reduction_cents AS debtReductionCents, r.reason
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 1000`
    )
    .all(...params) as {
    id: number
    returnNo: string
    saleId: number
    invoiceNo: string
    createdAt: string
    userName: string
    totalCents: number
    cashRefundCents: number
    debtReductionCents: number
    reason: string | null
  }[]
}

// ======================= Customer payments =======================

export const customerPaymentSchema = z.object({
  customerId: z.number().int().positive(),
  amount: decimalInput,
  method: z.string().min(1),
  notes: z.string().max(300).optional().nullable()
})

/** Records a debt repayment as a new immutable transaction. */
export function recordCustomerPayment(ctx: Ctx, raw: unknown) {
  const input = customerPaymentSchema.parse(raw)
  const db = ctx.db
  if (!hasPerm(ctx.user, 'credits.collect')) throw new AppError('FORBIDDEN', { permission: 'credits.collect' })
  return db
    .transaction(() => {
      const amount = toCents(input.amount)
      if (amount <= 0) throw new AppError('INVALID_AMOUNT')
      const balance = getCustomerBalance(db, input.customerId)
      if (amount > balance) throw new AppError('PAYMENT_EXCEEDS_DEBT', { balance })
      const cash = isCashMethod(db, input.method)
      const sessionId = cash ? sessionIdForCash(db, ctx.user.id) : null
      if (cash && getSettings(db).sales.requireCashSession && !sessionId) throw new AppError('NO_OPEN_SESSION')
      const seq = nextSequence(db, 'customer_receipt')
      const receiptNo = `RC${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
      const r = db
        .prepare(
          `INSERT INTO customer_payments (receipt_no, customer_id, amount_cents, method_code, created_at, user_id, session_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(receiptNo, input.customerId, amount, input.method, nowIso(), ctx.user.id, sessionId, input.notes ?? null)
      audit(db, ctx.user.id, 'CUSTOMER_PAYMENT', 'customer', input.customerId, { receiptNo, amountCents: amount })
      return getCustomerPayment(db, Number(r.lastInsertRowid))
    })
    .immediate()
}

export function getCustomerPayment(db: DB, id: number) {
  const p = db
    .prepare(
      `SELECT cp.id, cp.receipt_no AS receiptNo, cp.customer_id AS customerId, c.name AS customerName, c.phone AS customerPhone,
        cp.amount_cents AS amountCents, cp.method_code AS method, pm.name_fr AS methodFr, pm.name_ar AS methodAr,
        cp.created_at AS createdAt, u.full_name AS userName, cp.notes
       FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id JOIN users u ON u.id = cp.user_id
       JOIN payment_methods pm ON pm.code = cp.method_code WHERE cp.id = ?`
    )
    .get(id) as
    | {
        id: number
        receiptNo: string
        customerId: number
        customerName: string
        customerPhone: string | null
        amountCents: number
        method: string
        methodFr: string
        methodAr: string
        createdAt: string
        userName: string
        notes: string | null
      }
    | undefined
  if (!p) throw new AppError('NOT_FOUND')
  return { ...p, balanceAfterCents: balanceAt(db, p.customerId, p.id) }
}

/** Balance right after a given payment (for receipts). */
function balanceAt(db: DB, customerId: number, paymentId: number): number {
  const pay = db.prepare('SELECT created_at FROM customer_payments WHERE id = ?').get(paymentId) as { created_at: string }
  const v = db
    .prepare(
      `SELECT
        COALESCE((SELECT SUM(credit_cents) FROM sales WHERE customer_id = ? AND created_at <= ?), 0)
        - COALESCE((SELECT SUM(r.debt_reduction_cents) FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE s.customer_id = ? AND r.created_at <= ?), 0)
        - COALESCE((SELECT SUM(amount_cents) FROM customer_payments WHERE customer_id = ? AND id <= ?), 0) AS b`
    )
    .get(customerId, pay.created_at, customerId, pay.created_at, customerId, paymentId) as { b: number }
  return v.b
}

export function listCustomerPayments(db: DB, opts: { customerId?: number; from?: string; to?: string }) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.customerId) {
    where.push('cp.customer_id = ?')
    params.push(opts.customerId)
  }
  if (opts.from) {
    where.push('cp.created_at >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('cp.created_at < ?')
    params.push(opts.to)
  }
  return db
    .prepare(
      `SELECT cp.id, cp.receipt_no AS receiptNo, cp.customer_id AS customerId, c.name AS customerName, cp.amount_cents AS amountCents,
        cp.method_code AS method, cp.created_at AS createdAt, u.full_name AS userName, cp.notes
       FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id JOIN users u ON u.id = cp.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cp.id DESC LIMIT 2000`
    )
    .all(...params) as {
    id: number
    receiptNo: string
    customerId: number
    customerName: string
    amountCents: number
    method: string
    createdAt: string
    userName: string
    notes: string | null
  }[]
}

