import { z } from 'zod'
import type { DB } from '../db/connection'
import { AppError, audit, getSettings, hasPerm, likeTerm, nowIso, type Ctx } from './common'
import { isCashMethod, sessionIdForCash } from './cash'
import { toCents } from '@shared/money'

export const expenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  categoryId: z.number().int().positive(),
  amount: z.union([z.string(), z.number()]),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.string().min(1),
  notes: z.string().max(500).optional().nullable()
})

export function listExpenseCategories(db: DB) {
  return db
    .prepare('SELECT id, code, name_fr AS nameFr, name_ar AS nameAr, active FROM expense_categories WHERE active = 1 ORDER BY id')
    .all() as { id: number; code: string | null; nameFr: string; nameAr: string; active: number }[]
}

export function saveExpenseCategory(ctx: Ctx, input: { id?: number | null; nameFr: string; nameAr?: string }) {
  if (!hasPerm(ctx.user, 'expenses.manage')) throw new AppError('FORBIDDEN', { permission: 'expenses.manage' })
  const fr = input.nameFr.trim()
  const ar = (input.nameAr || fr).trim()
  if (!fr) throw new AppError('VALIDATION_ERROR')
  if (input.id) {
    ctx.db.prepare('UPDATE expense_categories SET name_fr = ?, name_ar = ? WHERE id = ?').run(fr, ar, input.id)
    return input.id
  }
  const r = ctx.db.prepare('INSERT INTO expense_categories (name_fr, name_ar, active) VALUES (?, ?, 1)').run(fr, ar)
  return Number(r.lastInsertRowid)
}

export function saveExpense(ctx: Ctx, id: number | null, raw: unknown) {
  if (!hasPerm(ctx.user, 'expenses.manage')) throw new AppError('FORBIDDEN', { permission: 'expenses.manage' })
  const input = expenseSchema.parse(raw)
  const amountCents = toCents(input.amount)
  if (amountCents <= 0) throw new AppError('INVALID_AMOUNT')
  const db = ctx.db
  return db.transaction(() => {
    const cat = db.prepare('SELECT id FROM expense_categories WHERE id = ?').get(input.categoryId)
    if (!cat) throw new AppError('NOT_FOUND')
    const cash = isCashMethod(db, input.method)
    const sessionId = cash ? sessionIdForCash(db, ctx.user.id) : null
    if (id === null) {
      if (cash && getSettings(db).sales.requireCashSession && !sessionId) throw new AppError('NO_OPEN_SESSION')
      const r = db
        .prepare(
          `INSERT INTO expenses (description, category_id, amount_cents, expense_date, method_code, notes, user_id, session_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.description,
          input.categoryId,
          amountCents,
          input.expenseDate,
          input.method,
          input.notes || null,
          ctx.user.id,
          sessionId,
          nowIso()
        )
      audit(db, ctx.user.id, 'EXPENSE_CREATED', 'expense', Number(r.lastInsertRowid), { amountCents, description: input.description })
      return Number(r.lastInsertRowid)
    }
    db.prepare(
      'UPDATE expenses SET description = ?, category_id = ?, amount_cents = ?, expense_date = ?, method_code = ?, notes = ? WHERE id = ? AND deleted = 0'
    ).run(input.description, input.categoryId, amountCents, input.expenseDate, input.method, input.notes || null, id)
    audit(db, ctx.user.id, 'EXPENSE_UPDATED', 'expense', id, { amountCents, description: input.description })
    return id
  })()
}

export function deleteExpense(ctx: Ctx, id: number) {
  if (!hasPerm(ctx.user, 'expenses.manage')) throw new AppError('FORBIDDEN', { permission: 'expenses.manage' })
  ctx.db.prepare('UPDATE expenses SET deleted = 1 WHERE id = ?').run(id)
  audit(ctx.db, ctx.user.id, 'EXPENSE_DELETED', 'expense', id)
}

export function listExpenses(db: DB, opts: { from?: string; to?: string; categoryId?: number; search?: string } = {}) {
  const where = ['e.deleted = 0']
  const params: unknown[] = []
  if (opts.from) {
    where.push('e.expense_date >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('e.expense_date <= ?')
    params.push(opts.to)
  }
  if (opts.categoryId) {
    where.push('e.category_id = ?')
    params.push(opts.categoryId)
  }
  if (opts.search?.trim()) {
    const t = likeTerm(opts.search.trim())
    where.push("(e.description LIKE ? ESCAPE '\\' OR e.notes LIKE ? ESCAPE '\\')")
    params.push(t, t)
  }
  const items = db
    .prepare(
      `SELECT e.id, e.description, e.category_id AS categoryId, c.name_fr AS categoryNameFr, c.name_ar AS categoryNameAr,
        e.amount_cents AS amountCents, e.expense_date AS expenseDate, e.method_code AS method, pm.name_fr AS methodFr,
        pm.name_ar AS methodAr, e.notes, u.full_name AS userName, e.created_at AS createdAt
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN users u ON u.id = e.user_id
       JOIN payment_methods pm ON pm.code = e.method_code
       WHERE ${where.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT 2000`
    )
    .all(...params) as {
    id: number
    description: string
    categoryId: number
    categoryNameFr: string
    categoryNameAr: string
    amountCents: number
    expenseDate: string
    method: string
    methodFr: string
    methodAr: string
    notes: string | null
    userName: string
    createdAt: string
  }[]
  const byCategory = db
    .prepare(
      `SELECT c.id AS categoryId, c.name_fr AS nameFr, c.name_ar AS nameAr, COALESCE(SUM(e.amount_cents),0) AS totalCents
       FROM expense_categories c LEFT JOIN expenses e ON e.category_id = c.id AND ${where.join(' AND ')}
       GROUP BY c.id HAVING totalCents > 0 ORDER BY totalCents DESC`
    )
    .all(...params) as { categoryId: number; nameFr: string; nameAr: string; totalCents: number }[]
  const byMonth = db
    .prepare(
      `SELECT substr(e.expense_date, 1, 7) AS month, SUM(e.amount_cents) AS totalCents, COUNT(*) AS count
       FROM expenses e WHERE ${where.join(' AND ')} GROUP BY month ORDER BY month DESC LIMIT 24`
    )
    .all(...params) as { month: string; totalCents: number; count: number }[]
  const totalCents = items.reduce((a, b) => a + b.amountCents, 0)
  return { items, totalCents, byCategory, byMonth }
}

