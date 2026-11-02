import { z } from 'zod'
import type { DB } from '../db/connection'
import { AppError, audit, getSetting, likeTerm, nowIso, type Ctx } from './common'
import { toMilli, toCents, lineAmount, weightedAverageCost } from '@shared/money'

export type MovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'SALE_RETURN'
  | 'PURCHASE_RETURN'
  | 'ADJUSTMENT'
  | 'INITIAL_STOCK'
  | 'DAMAGE'
  | 'EXPIRATION'
  | 'INVENTORY'

export interface MovementInput {
  productId: number
  type: MovementType
  qtyMilli: number // signed: + increases stock, - decreases
  unitCostCents?: number
  refType?: string
  refId?: number
  note?: string | null
  userId: number | null
  /** Overrides the "allow negative stock" setting (e.g. sales when authorized). */
  allowNegative?: boolean
  /** When true and qty > 0, updates weighted average cost with unitCostCents. */
  updateAverageCost?: boolean
}

/**
 * THE ONLY function allowed to change products.stock_milli.
 * Records a stock movement and updates the cached stock in the same transaction
 * (callers must already be inside a transaction for multi-step operations).
 */
export function applyStockMovement(db: DB, m: MovementInput): { balanceAfter: number; movementId: number } {
  if (!Number.isInteger(m.qtyMilli) || m.qtyMilli === 0) throw new AppError('INVALID_QUANTITY')
  const p = db
    .prepare('SELECT id, name_fr, stock_milli, avg_cost_cents FROM products WHERE id = ?')
    .get(m.productId) as { id: number; name_fr: string; stock_milli: number; avg_cost_cents: number } | undefined
  if (!p) throw new AppError('PRODUCT_NOT_FOUND')
  const balanceAfter = p.stock_milli + m.qtyMilli
  if (m.qtyMilli < 0 && balanceAfter < 0) {
    const allow = m.allowNegative ?? getSetting(db, 'sales').allowNegativeStock
    if (!allow) throw new AppError('INSUFFICIENT_STOCK', { product: p.name_fr, available: p.stock_milli })
  }
  let avgCost = p.avg_cost_cents
  if (m.updateAverageCost && m.qtyMilli > 0 && m.unitCostCents !== undefined) {
    avgCost = weightedAverageCost(p.stock_milli, p.avg_cost_cents, m.qtyMilli, m.unitCostCents)
  }
  const unitCost = m.unitCostCents ?? p.avg_cost_cents
  const now = nowIso()
  db.prepare('UPDATE products SET stock_milli = ?, avg_cost_cents = ?, updated_at = ? WHERE id = ?').run(
    balanceAfter,
    avgCost,
    now,
    m.productId
  )
  const r = db
    .prepare(
      `INSERT INTO stock_movements (product_id, type, qty_milli, balance_after_milli, unit_cost_cents, ref_type, ref_id, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(m.productId, m.type, m.qtyMilli, balanceAfter, unitCost, m.refType ?? null, m.refId ?? null, m.note ?? null, m.userId, now)
  return { balanceAfter, movementId: Number(r.lastInsertRowid) }
}

// ---------------- Manual stock operations ----------------

export const manualMovementSchema = z.object({
  productId: z.number().int().positive(),
  type: z.enum(['ADJUSTMENT', 'DAMAGE', 'EXPIRATION', 'INITIAL_STOCK', 'PURCHASE']),
  direction: z.enum(['in', 'out']),
  qty: z.union([z.string(), z.number()]),
  unitCost: z.union([z.string(), z.number()]).optional(),
  note: z.string().max(500).optional().nullable()
})

export function manualMovement(ctx: Ctx, raw: unknown) {
  const input = manualMovementSchema.parse(raw)
  const qty = toMilli(input.qty)
  if (qty <= 0) throw new AppError('INVALID_QUANTITY')
  let direction = input.direction
  if (input.type === 'DAMAGE' || input.type === 'EXPIRATION') direction = 'out'
  if (input.type === 'INITIAL_STOCK' || input.type === 'PURCHASE') direction = 'in'
  const signed = direction === 'in' ? qty : -qty
  const db = ctx.db
  return db.transaction(() => {
    const unitCost = input.unitCost !== undefined && input.unitCost !== '' ? toCents(input.unitCost) : undefined
    const res = applyStockMovement(db, {
      productId: input.productId,
      type: input.type,
      qtyMilli: signed,
      unitCostCents: unitCost,
      updateAverageCost: direction === 'in' && unitCost !== undefined,
      refType: 'manual',
      note: input.note ?? null,
      userId: ctx.user.id
    })
    audit(db, ctx.user.id, 'STOCK_MOVEMENT', 'product', input.productId, { type: input.type, qtyMilli: signed })
    return res
  })()
}

export function listMovements(
  db: DB,
  opts: { productId?: number; type?: string; from?: string; to?: string; limit?: number; search?: string }
) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.productId) {
    where.push('m.product_id = ?')
    params.push(opts.productId)
  }
  if (opts.type) {
    where.push('m.type = ?')
    params.push(opts.type)
  }
  if (opts.from) {
    where.push('m.created_at >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('m.created_at < ?')
    params.push(opts.to)
  }
  if (opts.search) {
    where.push("(p.name_fr LIKE ? ESCAPE '\\' OR p.name_ar LIKE ? ESCAPE '\\')")
    params.push(likeTerm(opts.search), likeTerm(opts.search))
  }
  params.push(Math.min(opts.limit ?? 500, 5000))
  return db
    .prepare(
      `SELECT m.id, m.product_id AS productId, p.name_fr AS productName, p.name_ar AS productNameAr, p.unit_code AS unitCode,
        m.type, m.qty_milli AS qtyMilli, m.balance_after_milli AS balanceAfterMilli, m.unit_cost_cents AS unitCostCents,
        m.ref_type AS refType, m.ref_id AS refId, m.note, m.created_at AS createdAt, u.full_name AS userName
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(...params) as {
    id: number
    productId: number
    productName: string
    productNameAr: string | null
    unitCode: string
    type: MovementType
    qtyMilli: number
    balanceAfterMilli: number
    unitCostCents: number
    refType: string | null
    refId: number | null
    note: string | null
    createdAt: string
    userName: string | null
  }[]
}

export function stockOverview(db: DB, opts: { filter?: 'all' | 'low' | 'out' | 'expiring'; search?: string; categoryId?: number }) {
  const where = ['p.archived = 0']
  const params: unknown[] = []
  if (opts.filter === 'low') where.push('p.stock_milli > 0 AND p.stock_milli <= p.min_stock_milli')
  if (opts.filter === 'out') where.push('p.stock_milli <= 0')
  if (opts.filter === 'expiring') {
    const days = getSetting(db, 'stock').expiryAlertDays
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    where.push('p.track_expiry = 1 AND p.expiry_date IS NOT NULL AND p.expiry_date <= ?')
    params.push(limit)
  }
  if (opts.categoryId) {
    where.push('p.category_id = ?')
    params.push(opts.categoryId)
  }
  if (opts.search) {
    where.push(
      "(p.name_fr LIKE ? ESCAPE '\\' OR p.name_ar LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.code = ?))"
    )
    const t = likeTerm(opts.search)
    params.push(t, t, t, opts.search)
  }
  const rows = db
    .prepare(
      `SELECT p.id, p.name_fr AS nameFr, p.name_ar AS nameAr, p.sku, p.unit_code AS unitCode, p.stock_milli AS stockMilli,
        p.min_stock_milli AS minStockMilli, p.avg_cost_cents AS avgCostCents, p.sale_price_cents AS salePriceCents,
        p.expiry_date AS expiryDate, p.track_expiry AS trackExpiry, c.name_fr AS categoryName, c.name_ar AS categoryNameAr
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.name_fr COLLATE NOCASE LIMIT 5000`
    )
    .all(...params) as {
    id: number
    nameFr: string
    nameAr: string | null
    sku: string | null
    unitCode: string
    stockMilli: number
    minStockMilli: number
    avgCostCents: number
    salePriceCents: number
    expiryDate: string | null
    trackExpiry: number
    categoryName: string | null
    categoryNameAr: string | null
  }[]
  return rows.map((r) => ({
    ...r,
    trackExpiry: !!r.trackExpiry,
    valueCents: r.stockMilli > 0 ? lineAmount(r.stockMilli, r.avgCostCents) : 0
  }))
}

// ---------------- Inventory counting ----------------

export function listInventoryCounts(db: DB) {
  return db
    .prepare(
      `SELECT ic.id, ic.status, ic.created_at AS createdAt, ic.finalized_at AS finalizedAt, ic.notes, u.full_name AS userName,
        (SELECT COUNT(*) FROM inventory_count_items i WHERE i.count_id = ic.id) AS itemCount,
        (SELECT COUNT(*) FROM inventory_count_items i WHERE i.count_id = ic.id AND i.counted_milli IS NOT NULL) AS countedCount
       FROM inventory_counts ic JOIN users u ON u.id = ic.user_id ORDER BY ic.id DESC`
    )
    .all() as {
    id: number
    status: 'open' | 'finalized' | 'cancelled'
    createdAt: string
    finalizedAt: string | null
    notes: string | null
    userName: string
    itemCount: number
    countedCount: number
  }[]
}

export function createInventoryCount(ctx: Ctx, opts: { categoryId?: number | null; notes?: string | null }) {
  const db = ctx.db
  return db.transaction(() => {
    const open = db.prepare(`SELECT id FROM inventory_counts WHERE status = 'open'`).get()
    if (open) throw new AppError('INVENTORY_ALREADY_OPEN')
    const r = db
      .prepare('INSERT INTO inventory_counts (status, created_at, user_id, notes) VALUES (?, ?, ?, ?)')
      .run('open', nowIso(), ctx.user.id, opts.notes ?? null)
    const id = Number(r.lastInsertRowid)
    const params: unknown[] = [id]
    let catFilter = ''
    if (opts.categoryId) {
      catFilter = 'AND category_id = ?'
      params.push(opts.categoryId)
    }
    db.prepare(
      `INSERT INTO inventory_count_items (count_id, product_id, expected_milli, unit_cost_cents)
       SELECT ?, id, stock_milli, avg_cost_cents FROM products WHERE archived = 0 AND active = 1 ${catFilter}`
    ).run(...params)
    audit(db, ctx.user.id, 'INVENTORY_STARTED', 'inventory', id)
    return id
  })()
}

export function getInventoryCount(db: DB, id: number) {
  const head = db.prepare('SELECT id, status, created_at AS createdAt, finalized_at AS finalizedAt, notes FROM inventory_counts WHERE id = ?').get(id)
  if (!head) throw new AppError('NOT_FOUND')
  const items = db
    .prepare(
      `SELECT i.id, i.product_id AS productId, p.name_fr AS nameFr, p.name_ar AS nameAr, p.sku, p.unit_code AS unitCode,
        i.expected_milli AS expectedMilli, i.counted_milli AS countedMilli, i.unit_cost_cents AS unitCostCents,
        (SELECT GROUP_CONCAT(code, ' ') FROM product_barcodes b WHERE b.product_id = p.id) AS barcodes
       FROM inventory_count_items i JOIN products p ON p.id = i.product_id
       WHERE i.count_id = ? ORDER BY p.name_fr COLLATE NOCASE`
    )
    .all(id) as {
    id: number
    productId: number
    nameFr: string
    nameAr: string | null
    sku: string | null
    unitCode: string
    expectedMilli: number
    countedMilli: number | null
    unitCostCents: number
    barcodes: string | null
  }[]
  return {
    ...(head as { id: number; status: string; createdAt: string; finalizedAt: string | null; notes: string | null }),
    items: items.map((i) => ({
      ...i,
      differenceMilli: i.countedMilli === null ? null : i.countedMilli - i.expectedMilli,
      differenceValueCents: i.countedMilli === null ? null : lineAmount(i.countedMilli - i.expectedMilli, i.unitCostCents)
    }))
  }
}

export function setCountedQty(ctx: Ctx, itemId: number, qty: string | number | null) {
  const db = ctx.db
  const row = db
    .prepare('SELECT ic.status FROM inventory_count_items i JOIN inventory_counts ic ON ic.id = i.count_id WHERE i.id = ?')
    .get(itemId) as { status: string } | undefined
  if (!row) throw new AppError('NOT_FOUND')
  if (row.status !== 'open') throw new AppError('INVENTORY_CLOSED')
  const milli = qty === null || qty === '' ? null : toMilli(qty)
  if (milli !== null && milli < 0) throw new AppError('INVALID_QUANTITY')
  db.prepare('UPDATE inventory_count_items SET counted_milli = ? WHERE id = ?').run(milli, itemId)
}

/**
 * Finalizes a count: for each counted item, the difference between counted and the
 * CURRENT stock (sales may have happened during counting, so expected is re-read) is
 * recorded as an INVENTORY movement. Uncounted items are left unchanged.
 */
export function finalizeInventoryCount(ctx: Ctx, id: number) {
  const db = ctx.db
  return db.transaction(() => {
    const head = db.prepare('SELECT status FROM inventory_counts WHERE id = ?').get(id) as { status: string } | undefined
    if (!head) throw new AppError('NOT_FOUND')
    if (head.status !== 'open') throw new AppError('INVENTORY_CLOSED')
    const items = db
      .prepare(
        `SELECT i.product_id, i.counted_milli, i.expected_milli, p.stock_milli
         FROM inventory_count_items i JOIN products p ON p.id = i.product_id
         WHERE i.count_id = ? AND i.counted_milli IS NOT NULL`
      )
      .all(id) as { product_id: number; counted_milli: number; expected_milli: number; stock_milli: number }[]
    let adjusted = 0
    for (const it of items) {
      // Delta measured against expected at count start, applied to the current stock.
      const delta = it.counted_milli - it.expected_milli
      if (delta !== 0) {
        applyStockMovement(db, {
          productId: it.product_id,
          type: 'INVENTORY',
          qtyMilli: delta,
          refType: 'inventory',
          refId: id,
          note: null,
          userId: ctx.user.id,
          allowNegative: true
        })
        adjusted++
      }
    }
    db.prepare(`UPDATE inventory_counts SET status = 'finalized', finalized_at = ? WHERE id = ?`).run(nowIso(), id)
    audit(db, ctx.user.id, 'INVENTORY_FINALIZED', 'inventory', id, { adjusted })
    return { adjusted }
  })()
}

export function cancelInventoryCount(ctx: Ctx, id: number) {
  const r = ctx.db.prepare(`UPDATE inventory_counts SET status = 'cancelled', finalized_at = ? WHERE id = ? AND status = 'open'`).run(nowIso(), id)
  if (!r.changes) throw new AppError('INVENTORY_CLOSED')
  audit(ctx.db, ctx.user.id, 'INVENTORY_CANCELLED', 'inventory', id)
}

