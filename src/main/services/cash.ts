import type { DB } from '../db/connection'
import { AppError, audit, hasPerm, nowIso, type Ctx } from './common'
import { toCents } from '@shared/money'

export interface CashSessionSummary {
  id: number
  userId: number
  userName: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt: string | null
  closedByName: string | null
  openingCents: number
  cashSalesCents: number
  cashCustomerPaymentsCents: number
  cashRefundsCents: number
  cashExpensesCents: number
  cashSupplierPaymentsCents: number
  expectedCents: number
  countedCents: number | null
  differenceCents: number | null
  salesCount: number
  salesTotalCents: number
  nonCashSalesCents: number
  creditSalesCents: number
  notes: string | null
}

export function getOpenSession(db: DB, userId: number): { id: number } | undefined {
  return db.prepare(`SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'open'`).get(userId) as { id: number } | undefined
}

/** Returns the open session id for a cash operation, or null if the user has none. */
export function sessionIdForCash(db: DB, userId: number): number | null {
  return getOpenSession(db, userId)?.id ?? null
}

export function isCashMethod(db: DB, code: string): boolean {
  const row = db.prepare('SELECT is_cash FROM payment_methods WHERE code = ?').get(code) as { is_cash: number } | undefined
  if (!row) throw new AppError('INVALID_PAYMENT_METHOD', { method: code })
  return !!row.is_cash
}

export function cashMethodCodes(db: DB): string[] {
  return (db.prepare('SELECT code FROM payment_methods WHERE is_cash = 1').all() as { code: string }[]).map((r) => r.code)
}

export function computeSession(db: DB, id: number): CashSessionSummary {
  const s = db
    .prepare(
      `SELECT cs.*, u.full_name AS user_name, cb.full_name AS closed_by_name FROM cash_sessions cs
       JOIN users u ON u.id = cs.user_id LEFT JOIN users cb ON cb.id = cs.closed_by WHERE cs.id = ?`
    )
    .get(id) as
    | {
        id: number
        user_id: number
        user_name: string
        status: 'open' | 'closed'
        opened_at: string
        closed_at: string | null
        closed_by_name: string | null
        opening_cents: number
        counted_cents: number | null
        expected_cents: number | null
        difference_cents: number | null
        notes: string | null
      }
    | undefined
  if (!s) throw new AppError('NOT_FOUND')
  const one = (sql: string) => ((db.prepare(sql).get(id) as { v: number | null }).v ?? 0) as number
  const cashSales = one(
    `SELECT SUM(sp.amount_cents) AS v FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
     JOIN payment_methods pm ON pm.code = sp.method_code WHERE sa.session_id = ? AND pm.is_cash = 1`
  )
  const nonCashSales = one(
    `SELECT SUM(sp.amount_cents) AS v FROM sale_payments sp JOIN sales sa ON sa.id = sp.sale_id
     JOIN payment_methods pm ON pm.code = sp.method_code WHERE sa.session_id = ? AND pm.is_cash = 0`
  )
  const cashCustomer = one(
    `SELECT SUM(cp.amount_cents) AS v FROM customer_payments cp JOIN payment_methods pm ON pm.code = cp.method_code
     WHERE cp.session_id = ? AND pm.is_cash = 1`
  )
  const refunds = one(`SELECT SUM(cash_refund_cents) AS v FROM sale_returns WHERE session_id = ?`)
  const expenses = one(
    `SELECT SUM(e.amount_cents) AS v FROM expenses e JOIN payment_methods pm ON pm.code = e.method_code
     WHERE e.session_id = ? AND pm.is_cash = 1 AND e.deleted = 0`
  )
  const supplier = one(
    `SELECT SUM(pp.amount_cents) AS v FROM purchase_payments pp JOIN payment_methods pm ON pm.code = pp.method_code
     WHERE pp.session_id = ? AND pm.is_cash = 1`
  )
  const salesAgg = db
    .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(total_cents),0) AS t, COALESCE(SUM(credit_cents),0) AS cr FROM sales WHERE session_id = ?')
    .get(id) as { c: number; t: number; cr: number }
  const expected = s.opening_cents + cashSales + cashCustomer - refunds - expenses - supplier
  return {
    id: s.id,
    userId: s.user_id,
    userName: s.user_name,
    status: s.status,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    closedByName: s.closed_by_name,
    openingCents: s.opening_cents,
    cashSalesCents: cashSales,
    cashCustomerPaymentsCents: cashCustomer,
    cashRefundsCents: refunds,
    cashExpensesCents: expenses,
    cashSupplierPaymentsCents: supplier,
    expectedCents: s.status === 'closed' && s.expected_cents !== null ? s.expected_cents : expected,
    countedCents: s.counted_cents,
    differenceCents: s.difference_cents,
    salesCount: salesAgg.c,
    salesTotalCents: salesAgg.t,
    nonCashSalesCents: nonCashSales,
    creditSalesCents: salesAgg.cr,
    notes: s.notes
  }
}

export function currentSession(ctx: Ctx): CashSessionSummary | null {
  const open = getOpenSession(ctx.db, ctx.user.id)
  return open ? computeSession(ctx.db, open.id) : null
}

export function openSession(ctx: Ctx, opening: string | number, notes?: string | null): CashSessionSummary {
  const db = ctx.db
  const cents = toCents(opening)
  if (cents < 0) throw new AppError('INVALID_AMOUNT')
  const id = db.transaction(() => {
    if (getOpenSession(db, ctx.user.id)) throw new AppError('SESSION_ALREADY_OPEN')
    const r = db
      .prepare(`INSERT INTO cash_sessions (user_id, status, opened_at, opening_cents, notes) VALUES (?, 'open', ?, ?, ?)`)
      .run(ctx.user.id, nowIso(), cents, notes ?? null)
    audit(db, ctx.user.id, 'CASH_SESSION_OPENED', 'cash_session', Number(r.lastInsertRowid), { openingCents: cents })
    return Number(r.lastInsertRowid)
  })()
  return computeSession(db, id)
}

export function closeSession(ctx: Ctx, sessionId: number, counted: string | number, notes?: string | null): CashSessionSummary {
  const db = ctx.db
  const countedCents = toCents(counted)
  if (countedCents < 0) throw new AppError('INVALID_AMOUNT')
  db.transaction(() => {
    const s = db.prepare('SELECT user_id, status FROM cash_sessions WHERE id = ?').get(sessionId) as
      | { user_id: number; status: string }
      | undefined
    if (!s) throw new AppError('NOT_FOUND')
    if (s.status !== 'open') throw new AppError('SESSION_ALREADY_CLOSED')
    if (s.user_id !== ctx.user.id && !hasPerm(ctx.user, 'cash.close_any')) throw new AppError('CANNOT_CLOSE_OTHER_SESSION')
    const summary = computeSession(db, sessionId)
    const diff = countedCents - summary.expectedCents
    db.prepare(
      `UPDATE cash_sessions SET status = 'closed', closed_at = ?, closed_by = ?, expected_cents = ?, counted_cents = ?, difference_cents = ?,
        notes = COALESCE(?, notes) WHERE id = ?`
    ).run(nowIso(), ctx.user.id, summary.expectedCents, countedCents, diff, notes ?? null, sessionId)
    audit(db, ctx.user.id, 'CASH_SESSION_CLOSED', 'cash_session', sessionId, {
      expectedCents: summary.expectedCents,
      countedCents,
      differenceCents: diff
    })
  })()
  return computeSession(db, sessionId)
}

export function listSessions(db: DB, opts: { userId?: number; status?: 'open' | 'closed'; limit?: number }) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.userId) {
    where.push('user_id = ?')
    params.push(opts.userId)
  }
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  }
  const ids = db
    .prepare(`SELECT id FROM cash_sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
    .all(...params, opts.limit ?? 100) as { id: number }[]
  return ids.map((r) => computeSession(db, r.id))
}

export function listPaymentMethods(db: DB, includeInactive = false) {
  return (
    db
      .prepare(`SELECT code, name_fr AS nameFr, name_ar AS nameAr, is_cash AS isCash, active, builtin, sort FROM payment_methods ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, code`)
      .all() as { code: string; nameFr: string; nameAr: string; isCash: number; active: number; builtin: number; sort: number }[]
  ).map((m) => ({ ...m, isCash: !!m.isCash, active: !!m.active, builtin: !!m.builtin }))
}

export function savePaymentMethod(
  ctx: Ctx,
  input: { code: string; nameFr: string; nameAr: string; active: boolean; sort?: number }
) {
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '')
  if (!code || !input.nameFr.trim()) throw new AppError('VALIDATION_ERROR')
  const existing = ctx.db.prepare('SELECT builtin FROM payment_methods WHERE code = ?').get(code) as { builtin: number } | undefined
  if (existing) {
    if (code === 'CASH' && !input.active) throw new AppError('CANNOT_DISABLE_CASH')
    ctx.db
      .prepare('UPDATE payment_methods SET name_fr = ?, name_ar = ?, active = ?, sort = COALESCE(?, sort) WHERE code = ?')
      .run(input.nameFr.trim(), input.nameAr.trim() || input.nameFr.trim(), input.active ? 1 : 0, input.sort ?? null, code)
  } else {
    ctx.db
      .prepare('INSERT INTO payment_methods (code, name_fr, name_ar, is_cash, active, builtin, sort) VALUES (?, ?, ?, 0, ?, 0, ?)')
      .run(code, input.nameFr.trim(), input.nameAr.trim() || input.nameFr.trim(), input.active ? 1 : 0, input.sort ?? 50)
  }
  audit(ctx.db, ctx.user.id, 'PAYMENT_METHOD_SAVED', 'payment_method', null, { code })
}

