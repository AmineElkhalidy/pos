import { z } from 'zod'
import type { DB } from '../db/connection'
import { AppError, audit, getSettings, hasPerm, likeTerm, nextSequence, nowIso, type Ctx } from './common'
import { applyStockMovement } from './stock'
import { isCashMethod, sessionIdForCash } from './cash'
import { lineAmount, toCents, toMilli } from '@shared/money'
import Decimal from 'decimal.js'

const decimalInput = z.union([z.string(), z.number()])

export const purchaseInputSchema = z.object({
  supplierId: z.number().int().positive().nullable().optional(),
  supplierInvoiceNo: z.string().trim().max(80).optional().nullable(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiveNow: z.boolean().default(true),
  notes: z.string().max(500).optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: decimalInput,
        unitCost: decimalInput,
        expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
        updateSalePrice: decimalInput.optional().nullable()
      })
    )
    .min(1),
  initialPayment: z
    .object({
      amount: decimalInput,
      method: z.string().min(1),
      notes: z.string().max(300).optional().nullable()
    })
    .optional()
    .nullable()
})

export type PurchaseInput = z.input<typeof purchaseInputSchema>

export function createPurchase(ctx: Ctx, raw: unknown) {
  const input = purchaseInputSchema.parse(raw)
  const db = ctx.db
  if (!hasPerm(ctx.user, 'purchases.manage')) throw new AppError('FORBIDDEN', { permission: 'purchases.manage' })
  return db
    .transaction(() => {
      if (input.supplierId) {
        const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId)
        if (!sup) throw new AppError('SUPPLIER_NOT_FOUND')
      }
      const now = nowIso()
      const seq = nextSequence(db, 'purchase')
      const reference = `BL${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
      const status = input.receiveNow ? 'received' : 'ordered'

      const resolved = input.items.map((it) => {
        const p = db.prepare('SELECT id, name_fr FROM products WHERE id = ? AND archived = 0').get(it.productId) as
          | { id: number; name_fr: string }
          | undefined
        if (!p) throw new AppError('PRODUCT_NOT_FOUND')
        const qtyMilli = toMilli(it.qty)
        if (qtyMilli <= 0) throw new AppError('INVALID_QUANTITY', { product: p.name_fr })
        const unitCostCents = toCents(it.unitCost)
        if (unitCostCents < 0) throw new AppError('INVALID_PRICE', { product: p.name_fr })
        const totalCents = lineAmount(qtyMilli, unitCostCents)
        const saleOverride =
          it.updateSalePrice !== undefined && it.updateSalePrice !== null && it.updateSalePrice !== ''
            ? toCents(it.updateSalePrice)
            : null
        return {
          productId: p.id,
          qtyMilli,
          unitCostCents,
          totalCents,
          expiryDate: it.expiryDate || null,
          saleOverride
        }
      })

      const totalCents = resolved.reduce((acc, l) => acc + l.totalCents, 0)
      const res = db
        .prepare(
          `INSERT INTO purchases (reference, supplier_id, supplier_invoice_no, status, order_date, received_at, total_cents, notes, user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          reference,
          input.supplierId ?? null,
          input.supplierInvoiceNo || null,
          status,
          input.orderDate,
          input.receiveNow ? now : null,
          totalCents,
          input.notes || null,
          ctx.user.id,
          now,
          now
        )
      const purchaseId = Number(res.lastInsertRowid)
      const insItem = db.prepare(
        `INSERT INTO purchase_items (purchase_id, product_id, qty_milli, unit_cost_cents, total_cents, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const l of resolved) {
        insItem.run(purchaseId, l.productId, l.qtyMilli, l.unitCostCents, l.totalCents, l.expiryDate)
        if (input.receiveNow) {
          receiveLineIntoStock(db, purchaseId, reference, l, ctx.user.id)
        }
      }

      if (input.initialPayment) {
        const payAmt = toCents(input.initialPayment.amount)
        if (payAmt > 0) {
          addPurchasePaymentInternal(ctx, purchaseId, payAmt, input.initialPayment.method, input.initialPayment.notes ?? null)
        }
      }

      audit(db, ctx.user.id, 'PURCHASE_CREATED', 'purchase', purchaseId, { reference, status, totalCents })
      return getPurchase(db, purchaseId)
    })
    .immediate()
}

function receiveLineIntoStock(
  db: DB,
  purchaseId: number,
  reference: string,
  line: { productId: number; qtyMilli: number; unitCostCents: number; expiryDate: string | null; saleOverride?: number | null },
  userId: number
) {
  applyStockMovement(db, {
    productId: line.productId,
    type: 'PURCHASE',
    qtyMilli: line.qtyMilli,
    unitCostCents: line.unitCostCents,
    updateAverageCost: true,
    refType: 'purchase',
    refId: purchaseId,
    note: reference,
    userId
  })
  const now = nowIso()
  db.prepare('UPDATE products SET purchase_price_cents = ?, updated_at = ? WHERE id = ?').run(line.unitCostCents, now, line.productId)
  if (line.expiryDate) {
    db.prepare('UPDATE products SET expiry_date = ?, track_expiry = 1, updated_at = ? WHERE id = ?').run(line.expiryDate, now, line.productId)
  }
  if (line.saleOverride !== undefined && line.saleOverride !== null && line.saleOverride > 0) {
    db.prepare('UPDATE products SET sale_price_cents = ?, updated_at = ? WHERE id = ?').run(line.saleOverride, now, line.productId)
  }
}

export function receivePurchase(ctx: Ctx, purchaseId: number) {
  const db = ctx.db
  if (!hasPerm(ctx.user, 'purchases.manage')) throw new AppError('FORBIDDEN', { permission: 'purchases.manage' })
  return db
    .transaction(() => {
      const p = db.prepare('SELECT id, reference, status FROM purchases WHERE id = ?').get(purchaseId) as
        | { id: number; reference: string; status: string }
        | undefined
      if (!p) throw new AppError('NOT_FOUND')
      if (p.status === 'received') throw new AppError('PURCHASE_ALREADY_RECEIVED')
      if (p.status === 'cancelled') throw new AppError('PURCHASE_CANCELLED')
      const items = db
        .prepare('SELECT product_id, qty_milli, unit_cost_cents, expiry_date FROM purchase_items WHERE purchase_id = ?')
        .all(purchaseId) as { product_id: number; qty_milli: number; unit_cost_cents: number; expiry_date: string | null }[]
      for (const it of items) {
        receiveLineIntoStock(
          db,
          purchaseId,
          p.reference,
          { productId: it.product_id, qtyMilli: it.qty_milli, unitCostCents: it.unit_cost_cents, expiryDate: it.expiry_date },
          ctx.user.id
        )
      }
      const now = nowIso()
      db.prepare(`UPDATE purchases SET status = 'received', received_at = ?, updated_at = ? WHERE id = ?`).run(now, now, purchaseId)
      audit(db, ctx.user.id, 'PURCHASE_RECEIVED', 'purchase', purchaseId, { reference: p.reference })
      return getPurchase(db, purchaseId)
    })
    .immediate()
}

function addPurchasePaymentInternal(ctx: Ctx, purchaseId: number, amountCents: number, method: string, notes: string | null) {
  const db = ctx.db
  const p = db.prepare('SELECT id, total_cents, returned_cents, status FROM purchases WHERE id = ?').get(purchaseId) as
    | { id: number; total_cents: number; returned_cents: number; status: string }
    | undefined
  if (!p) throw new AppError('NOT_FOUND')
  if (p.status === 'cancelled') throw new AppError('PURCHASE_CANCELLED')
  const paid = (
    db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS v FROM purchase_payments WHERE purchase_id = ?').get(purchaseId) as { v: number }
  ).v
  const remaining = p.total_cents - p.returned_cents - paid
  if (amountCents <= 0 || amountCents > remaining) throw new AppError('PAYMENT_EXCEEDS_TOTAL')
  const cash = isCashMethod(db, method)
  const sessionId = cash ? sessionIdForCash(db, ctx.user.id) : null
  if (cash && getSettings(db).sales.requireCashSession && !sessionId) throw new AppError('NO_OPEN_SESSION')
  db.prepare(
    'INSERT INTO purchase_payments (purchase_id, amount_cents, method_code, created_at, user_id, session_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(purchaseId, amountCents, method, nowIso(), ctx.user.id, sessionId, notes)
  audit(db, ctx.user.id, 'PURCHASE_PAYMENT', 'purchase', purchaseId, { amountCents, method })
}

export function addPurchasePayment(
  ctx: Ctx,
  raw: { purchaseId: number; amount: string | number; method: string; notes?: string | null }
) {
  if (!hasPerm(ctx.user, 'purchases.manage')) throw new AppError('FORBIDDEN', { permission: 'purchases.manage' })
  const amountCents = toCents(raw.amount)
  return ctx.db
    .transaction(() => {
      addPurchasePaymentInternal(ctx, raw.purchaseId, amountCents, raw.method, raw.notes ?? null)
      return getPurchase(ctx.db, raw.purchaseId)
    })
    .immediate()
}

export const purchaseReturnSchema = z.object({
  purchaseId: z.number().int().positive(),
  items: z.array(z.object({ purchaseItemId: z.number().int().positive(), qty: decimalInput })).min(1),
  reason: z.string().max(300).optional().nullable()
})

export function createPurchaseReturn(ctx: Ctx, raw: unknown) {
  const input = purchaseReturnSchema.parse(raw)
  const db = ctx.db
  if (!hasPerm(ctx.user, 'purchases.manage')) throw new AppError('FORBIDDEN', { permission: 'purchases.manage' })
  return db
    .transaction(() => {
      const p = db.prepare('SELECT id, reference, status, returned_cents FROM purchases WHERE id = ?').get(input.purchaseId) as
        | { id: number; reference: string; status: string; returned_cents: number }
        | undefined
      if (!p) throw new AppError('NOT_FOUND')
      if (p.status !== 'received') throw new AppError('PURCHASE_NOT_RECEIVED')
      const now = nowIso()
      const r = db
        .prepare('INSERT INTO purchase_returns (purchase_id, created_at, user_id, total_cents, reason) VALUES (?, ?, ?, 0, ?)')
        .run(p.id, now, ctx.user.id, input.reason ?? null)
      const returnId = Number(r.lastInsertRowid)
      let total = 0
      for (const it of input.items) {
        const pi = db
          .prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?')
          .get(it.purchaseItemId, p.id) as
          | {
              id: number
              product_id: number
              qty_milli: number
              returned_milli: number
              unit_cost_cents: number
              total_cents: number
            }
          | undefined
        if (!pi) throw new AppError('NOT_FOUND')
        const qtyMilli = toMilli(it.qty)
        if (qtyMilli <= 0 || qtyMilli > pi.qty_milli - pi.returned_milli) throw new AppError('RETURN_EXCEEDS_PURCHASED')
        const isFinal = qtyMilli === pi.qty_milli - pi.returned_milli
        const already = (
          db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS a FROM purchase_return_items WHERE purchase_item_id = ?').get(pi.id) as {
            a: number
          }
        ).a
        const amount = isFinal
          ? pi.total_cents - already
          : new Decimal(pi.total_cents).mul(qtyMilli).div(pi.qty_milli).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
        db.prepare(
          'INSERT INTO purchase_return_items (return_id, purchase_item_id, product_id, qty_milli, amount_cents) VALUES (?, ?, ?, ?, ?)'
        ).run(returnId, pi.id, pi.product_id, qtyMilli, amount)
        db.prepare('UPDATE purchase_items SET returned_milli = returned_milli + ? WHERE id = ?').run(qtyMilli, pi.id)
        applyStockMovement(db, {
          productId: pi.product_id,
          type: 'PURCHASE_RETURN',
          qtyMilli: -qtyMilli,
          unitCostCents: pi.unit_cost_cents,
          refType: 'purchase_return',
          refId: returnId,
          note: p.reference,
          userId: ctx.user.id
        })
        total += amount
      }
      db.prepare('UPDATE purchase_returns SET total_cents = ? WHERE id = ?').run(total, returnId)
      db.prepare('UPDATE purchases SET returned_cents = returned_cents + ?, updated_at = ? WHERE id = ?').run(total, now, p.id)
      audit(db, ctx.user.id, 'PURCHASE_RETURN', 'purchase', p.id, { returnId, totalCents: total })
      return getPurchase(db, p.id)
    })
    .immediate()
}

export function getPurchase(db: DB, id: number) {
  const p = db
    .prepare(
      `SELECT p.id, p.reference, p.supplier_id AS supplierId, s.name AS supplierName, p.supplier_invoice_no AS supplierInvoiceNo,
        p.status, p.order_date AS orderDate, p.received_at AS receivedAt, p.total_cents AS totalCents,
        p.returned_cents AS returnedCents, p.notes, u.full_name AS userName, p.created_at AS createdAt,
        COALESCE((SELECT SUM(amount_cents) FROM purchase_payments pp WHERE pp.purchase_id = p.id), 0) AS paidCents
       FROM purchases p JOIN users u ON u.id = p.user_id LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`
    )
    .get(id) as
    | {
        id: number
        reference: string
        supplierId: number | null
        supplierName: string | null
        supplierInvoiceNo: string | null
        status: 'draft' | 'ordered' | 'received' | 'cancelled'
        orderDate: string
        receivedAt: string | null
        totalCents: number
        returnedCents: number
        paidCents: number
        notes: string | null
        userName: string
        createdAt: string
      }
    | undefined
  if (!p) throw new AppError('NOT_FOUND')
  const items = db
    .prepare(
      `SELECT pi.id, pi.product_id AS productId, pr.name_fr AS productName, pr.name_ar AS productNameAr, pr.unit_code AS unitCode,
        pi.qty_milli AS qtyMilli, pi.unit_cost_cents AS unitCostCents, pi.total_cents AS totalCents, pi.expiry_date AS expiryDate,
        pi.returned_milli AS returnedMilli
       FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id`
    )
    .all(id) as {
    id: number
    productId: number
    productName: string
    productNameAr: string | null
    unitCode: string
    qtyMilli: number
    unitCostCents: number
    totalCents: number
    expiryDate: string | null
    returnedMilli: number
  }[]
  const payments = db
    .prepare(
      `SELECT pp.id, pp.amount_cents AS amountCents, pp.method_code AS method, pp.created_at AS createdAt, u.full_name AS userName, pp.notes
       FROM purchase_payments pp JOIN users u ON u.id = pp.user_id WHERE pp.purchase_id = ? ORDER BY pp.id`
    )
    .all(id) as { id: number; amountCents: number; method: string; createdAt: string; userName: string; notes: string | null }[]
  const netCents = p.totalCents - p.returnedCents
  const remainingCents = Math.max(0, netCents - p.paidCents)
  const paymentStatus: 'paid' | 'partial' | 'unpaid' =
    remainingCents === 0 ? 'paid' : p.paidCents > 0 ? 'partial' : 'unpaid'
  return { ...p, netCents, remainingCents, paymentStatus, items, payments }
}

export function listPurchases(db: DB, opts: { supplierId?: number; status?: string; from?: string; to?: string; search?: string } = {}) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.supplierId) {
    where.push('p.supplier_id = ?')
    params.push(opts.supplierId)
  }
  if (opts.status) {
    where.push('p.status = ?')
    params.push(opts.status)
  }
  if (opts.from) {
    where.push('p.order_date >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('p.order_date <= ?')
    params.push(opts.to)
  }
  if (opts.search?.trim()) {
    const t = likeTerm(opts.search.trim())
    where.push("(p.reference LIKE ? ESCAPE '\\' OR p.supplier_invoice_no LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')")
    params.push(t, t, t)
  }
  const rows = db
    .prepare(
      `SELECT p.id, p.reference, p.supplier_id AS supplierId, s.name AS supplierName, p.supplier_invoice_no AS supplierInvoiceNo,
        p.status, p.order_date AS orderDate, p.received_at AS receivedAt, p.total_cents AS totalCents, p.returned_cents AS returnedCents,
        u.full_name AS userName, p.created_at AS createdAt,
        COALESCE((SELECT SUM(amount_cents) FROM purchase_payments pp WHERE pp.purchase_id = p.id), 0) AS paidCents,
        (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS itemCount
       FROM purchases p JOIN users u ON u.id = p.user_id LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 1000`
    )
    .all(...params) as {
    id: number
    reference: string
    supplierId: number | null
    supplierName: string | null
    supplierInvoiceNo: string | null
    status: string
    orderDate: string
    receivedAt: string | null
    totalCents: number
    returnedCents: number
    paidCents: number
    itemCount: number
    userName: string
    createdAt: string
  }[]
  return rows.map((r) => {
    const netCents = r.totalCents - r.returnedCents
    const remainingCents = Math.max(0, netCents - r.paidCents)
    const paymentStatus: 'paid' | 'partial' | 'unpaid' =
      remainingCents === 0 ? 'paid' : r.paidCents > 0 ? 'partial' : 'unpaid'
    return { ...r, netCents, remainingCents, paymentStatus }
  })
}

