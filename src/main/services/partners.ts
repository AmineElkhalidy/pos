import { z } from 'zod'
import type { DB } from '../db/connection'
import { AppError, audit, getSetting, likeTerm, nowIso, type Ctx } from './common'

// ======================= Customers =======================

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  creditLimit: z.union([z.string(), z.number()]).optional().nullable(),
  active: z.boolean().default(true)
})

/** Customer balance (debt) = credit given on sales − debt reductions from returns − payments received. */
export const BALANCE_SQL = `(
  COALESCE((SELECT SUM(s.credit_cents) FROM sales s WHERE s.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(r.debt_reduction_cents) FROM sale_returns r JOIN sales s2 ON s2.id = r.sale_id WHERE s2.customer_id = c.id), 0)
  - COALESCE((SELECT SUM(cp.amount_cents) FROM customer_payments cp WHERE cp.customer_id = c.id), 0)
)`

export interface CustomerRow {
  id: number
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  creditLimitCents: number | null
  active: boolean
  balanceCents: number
  lastSaleAt: string | null
  createdAt: string
}

export function listCustomers(db: DB, opts: { search?: string; withDebtOnly?: boolean; includeInactive?: boolean } = {}) {
  const where: string[] = []
  const params: unknown[] = []
  if (!opts.includeInactive) where.push('c.active = 1')
  if (opts.search?.trim()) {
    const t = likeTerm(opts.search.trim())
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')")
    params.push(t, t)
  }
  const sql = `SELECT * FROM (SELECT c.id, c.name, c.phone, c.address, c.notes, c.credit_limit_cents AS creditLimitCents, c.active,
      ${BALANCE_SQL} AS balanceCents,
      (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id) AS lastSaleAt, c.created_at AS createdAt
    FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) t
    ${opts.withDebtOnly ? 'WHERE t.balanceCents > 0' : ''}
    ORDER BY ${opts.withDebtOnly ? 't.balanceCents DESC' : 't.name COLLATE NOCASE'} LIMIT 2000`
  return (db.prepare(sql).all(...params) as (Omit<CustomerRow, 'active'> & { active: number })[]).map((r) => ({
    ...r,
    active: !!r.active
  })) as CustomerRow[]
}

export function getCustomerBalance(db: DB, customerId: number): number {
  const row = db.prepare(`SELECT ${BALANCE_SQL} AS b FROM customers c WHERE c.id = ?`).get(customerId) as { b: number } | undefined
  if (!row) throw new AppError('CUSTOMER_NOT_FOUND')
  return row.b
}

export function getCustomer(db: DB, id: number): CustomerRow {
  const r = listCustomers(db, { includeInactive: true }).find((c) => c.id === id)
  if (!r) throw new AppError('CUSTOMER_NOT_FOUND')
  return r
}

export function saveCustomer(ctx: Ctx, id: number | null, raw: unknown) {
  const input = customerSchema.parse(raw)
  const db = ctx.db
  const now = nowIso()
  const limit =
    input.creditLimit === null || input.creditLimit === undefined || input.creditLimit === ''
      ? null
      : Math.round(Number(String(input.creditLimit).replace(',', '.')) * 100)
  if (limit !== null && (isNaN(limit) || limit < 0)) throw new AppError('INVALID_AMOUNT')
  // Only administrators may change credit limits.
  if (id !== null && ctx.user.role !== 'ADMIN') {
    const old = db.prepare('SELECT credit_limit_cents FROM customers WHERE id = ?').get(id) as { credit_limit_cents: number | null }
    if (old && old.credit_limit_cents !== limit) throw new AppError('FORBIDDEN', { permission: 'credit_limit' })
  }
  if (id === null) {
    const finalLimit = ctx.user.role === 'ADMIN' ? limit : getSetting(db, 'sales').defaultCreditLimitCents
    const r = db
      .prepare(
        'INSERT INTO customers (name, phone, address, notes, credit_limit_cents, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(input.name, input.phone || null, input.address || null, input.notes || null, finalLimit, input.active ? 1 : 0, now, now)
    audit(db, ctx.user.id, 'CUSTOMER_CREATED', 'customer', Number(r.lastInsertRowid), { name: input.name })
    return Number(r.lastInsertRowid)
  }
  db.prepare(
    'UPDATE customers SET name = ?, phone = ?, address = ?, notes = ?, credit_limit_cents = ?, active = ?, updated_at = ? WHERE id = ?'
  ).run(input.name, input.phone || null, input.address || null, input.notes || null, limit, input.active ? 1 : 0, now, id)
  audit(db, ctx.user.id, 'CUSTOMER_UPDATED', 'customer', id, { name: input.name, creditLimitCents: limit })
  return id
}

export function deleteCustomer(ctx: Ctx, id: number): 'deleted' | 'deactivated' {
  const db = ctx.db
  const used = db
    .prepare('SELECT (SELECT COUNT(*) FROM sales WHERE customer_id = ?) + (SELECT COUNT(*) FROM customer_payments WHERE customer_id = ?) AS c')
    .get(id, id) as { c: number }
  if (used.c > 0) {
    if (getCustomerBalance(db, id) > 0) throw new AppError('CUSTOMER_HAS_DEBT')
    db.prepare('UPDATE customers SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id)
    audit(db, ctx.user.id, 'CUSTOMER_DEACTIVATED', 'customer', id)
    return 'deactivated'
  }
  db.prepare('DELETE FROM customers WHERE id = ?').run(id)
  audit(db, ctx.user.id, 'CUSTOMER_DELETED', 'customer', id)
  return 'deleted'
}

export interface StatementEntry {
  date: string
  type: 'sale' | 'payment' | 'return'
  reference: string
  refId: number
  debitCents: number // increases debt
  creditCents: number // decreases debt
  totalCents?: number
  paidCents?: number
  method?: string | null
  balanceCents: number
}

/** Chronological account statement with running balance. */
export function customerStatement(db: DB, customerId: number, from?: string, to?: string) {
  const customer = getCustomer(db, customerId)
  const sales = db
    .prepare(
      `SELECT id, invoice_no AS ref, created_at AS date, total_cents AS total, paid_cents AS paid, credit_cents AS credit FROM sales WHERE customer_id = ?`
    )
    .all(customerId) as { id: number; ref: string; date: string; total: number; paid: number; credit: number }[]
  const pays = db
    .prepare(
      `SELECT cp.id, cp.receipt_no AS ref, cp.created_at AS date, cp.amount_cents AS amount, cp.method_code AS method FROM customer_payments cp WHERE cp.customer_id = ?`
    )
    .all(customerId) as { id: number; ref: string; date: string; amount: number; method: string }[]
  const rets = db
    .prepare(
      `SELECT r.id, r.return_no AS ref, r.created_at AS date, r.debt_reduction_cents AS amount FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE s.customer_id = ? AND r.debt_reduction_cents > 0`
    )
    .all(customerId) as { id: number; ref: string; date: string; amount: number }[]
  const entries: Omit<StatementEntry, 'balanceCents'>[] = [
    ...sales.map((s) => ({
      date: s.date,
      type: 'sale' as const,
      reference: s.ref,
      refId: s.id,
      debitCents: s.credit,
      creditCents: 0,
      totalCents: s.total,
      paidCents: s.paid
    })),
    ...pays.map((p) => ({ date: p.date, type: 'payment' as const, reference: p.ref, refId: p.id, debitCents: 0, creditCents: p.amount, method: p.method })),
    ...rets.map((r) => ({ date: r.date, type: 'return' as const, reference: r.ref, refId: r.id, debitCents: 0, creditCents: r.amount }))
  ].sort((a, b) => a.date.localeCompare(b.date) || a.refId - b.refId)
  let balance = 0
  let opening = 0
  const out: StatementEntry[] = []
  for (const e of entries) {
    balance += e.debitCents - e.creditCents
    if (from && e.date < from) {
      opening = balance
      continue
    }
    if (to && e.date >= to) continue
    out.push({ ...e, balanceCents: balance })
  }
  return { customer, openingBalanceCents: opening, entries: out, closingBalanceCents: out.length ? out[out.length - 1].balanceCents : opening }
}

// ======================= Suppliers =======================

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  email: z.string().trim().max(120).email().optional().nullable().or(z.literal('')),
  notes: z.string().max(1000).optional().nullable(),
  active: z.boolean().default(true)
})

export const SUPPLIER_BALANCE_SQL = `(
  COALESCE((SELECT SUM(p.total_cents - p.returned_cents) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'received'), 0)
  - COALESCE((SELECT SUM(pp.amount_cents) FROM purchase_payments pp JOIN purchases p2 ON p2.id = pp.purchase_id WHERE p2.supplier_id = s.id), 0)
)`

export function listSuppliers(db: DB, opts: { search?: string; includeInactive?: boolean } = {}) {
  const where: string[] = []
  const params: unknown[] = []
  if (!opts.includeInactive) where.push('s.active = 1')
  if (opts.search?.trim()) {
    const t = likeTerm(opts.search.trim())
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\')")
    params.push(t, t, t)
  }
  return (
    db
      .prepare(
        `SELECT s.id, s.name, s.phone, s.address, s.email, s.notes, s.active, ${SUPPLIER_BALANCE_SQL} AS balanceCents,
          (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchaseCount, s.created_at AS createdAt
         FROM suppliers s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.name COLLATE NOCASE`
      )
      .all(...params) as {
      id: number
      name: string
      phone: string | null
      address: string | null
      email: string | null
      notes: string | null
      active: number
      balanceCents: number
      purchaseCount: number
      createdAt: string
    }[]
  ).map((r) => ({ ...r, active: !!r.active }))
}

export function saveSupplier(ctx: Ctx, id: number | null, raw: unknown) {
  const input = supplierSchema.parse(raw)
  const db = ctx.db
  const now = nowIso()
  if (id === null) {
    const r = db
      .prepare('INSERT INTO suppliers (name, phone, address, email, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(input.name, input.phone || null, input.address || null, input.email || null, input.notes || null, input.active ? 1 : 0, now, now)
    audit(db, ctx.user.id, 'SUPPLIER_CREATED', 'supplier', Number(r.lastInsertRowid), { name: input.name })
    return Number(r.lastInsertRowid)
  }
  db.prepare('UPDATE suppliers SET name = ?, phone = ?, address = ?, email = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?').run(
    input.name,
    input.phone || null,
    input.address || null,
    input.email || null,
    input.notes || null,
    input.active ? 1 : 0,
    now,
    id
  )
  audit(db, ctx.user.id, 'SUPPLIER_UPDATED', 'supplier', id, { name: input.name })
  return id
}

export function deleteSupplier(ctx: Ctx, id: number): 'deleted' | 'deactivated' {
  const db = ctx.db
  const used = (db.prepare('SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?').get(id) as { c: number }).c
  if (used > 0) {
    db.prepare('UPDATE suppliers SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id)
    audit(db, ctx.user.id, 'SUPPLIER_DEACTIVATED', 'supplier', id)
    return 'deactivated'
  }
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
  audit(db, ctx.user.id, 'SUPPLIER_DELETED', 'supplier', id)
  return 'deleted'
}

