import { z } from 'zod'
import type { DB } from '../db/connection'
import { isPermission, PERMISSIONS, type Permission, type RoleCode } from '@shared/permissions'
import { AppError, audit, nowIso, type Ctx, type SessionUser } from './common'
import { hashPassword, verifyPassword } from './password'

interface UserRow {
  id: number
  username: string
  full_name: string
  password_hash: string
  role_id: number
  role_code: RoleCode
  active: number
  must_change_password: number
  language: 'fr' | 'ar'
  last_login_at: string | null
  created_at: string
}

export function rolePermissions(db: DB, roleCode: RoleCode): Permission[] {
  if (roleCode === 'ADMIN') return [...PERMISSIONS]
  const rows = db
    .prepare(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = ?`
    )
    .all(roleCode) as { code: string }[]
  return rows.map((r) => r.code).filter(isPermission)
}

function toSessionUser(db: DB, u: UserRow): SessionUser {
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role_code,
    permissions: rolePermissions(db, u.role_code),
    mustChangePassword: !!u.must_change_password,
    language: u.language
  }
}

const USER_SELECT = `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id`

/** In-memory brute-force protection: lock a username for 60s after 5 failures. */
const failures = new Map<string, { count: number; until: number }>()

export function login(db: DB, username: string, password: string): SessionUser {
  const trimmed = username.trim()
  if (!trimmed) throw new AppError('USERNAME_REQUIRED')
  if (!password) throw new AppError('PASSWORD_REQUIRED')
  const key = trimmed.toLowerCase()
  const f = failures.get(key)
  if (f && f.until > Date.now()) {
    throw new AppError('LOGIN_LOCKED', { seconds: Math.ceil((f.until - Date.now()) / 1000) })
  }
  const u = db.prepare(`${USER_SELECT} WHERE u.username = ? COLLATE NOCASE`).get(trimmed) as UserRow | undefined
  if (!u) {
    const count = (f?.count ?? 0) + 1
    failures.set(key, { count, until: count >= 5 ? Date.now() + 60_000 : 0 })
    audit(db, null, 'LOGIN_FAILED', 'user', null, { username: trimmed, reason: 'USER_NOT_FOUND' })
    throw new AppError('USER_NOT_FOUND', { username: trimmed })
  }
  if (!u.active) {
    audit(db, u.id, 'LOGIN_FAILED', 'user', u.id, { username: trimmed, reason: 'USER_INACTIVE' })
    throw new AppError('USER_INACTIVE', { username: trimmed })
  }
  if (!verifyPassword(password, u.password_hash)) {
    const count = (f?.count ?? 0) + 1
    failures.set(key, { count, until: count >= 5 ? Date.now() + 60_000 : 0 })
    audit(db, u.id, 'LOGIN_FAILED', 'user', u.id, { username: trimmed, reason: 'WRONG_PASSWORD' })
    throw new AppError('WRONG_PASSWORD', { remaining: Math.max(0, 5 - count) })
  }
  failures.delete(key)
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), u.id)
  audit(db, u.id, 'LOGIN', 'user', u.id)
  return toSessionUser(db, u)
}

export function refreshSessionUser(db: DB, userId: number): SessionUser | null {
  const u = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(userId) as UserRow | undefined
  if (!u || !u.active) return null
  return toSessionUser(db, u)
}

export function changeOwnPassword(ctx: Ctx, current: string, next: string): void {
  const u = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id) as { password_hash: string }
  if (!verifyPassword(current, u.password_hash)) throw new AppError('INVALID_CURRENT_PASSWORD')
  validatePassword(next)
  ctx.db
    .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .run(hashPassword(next), nowIso(), ctx.user.id)
  audit(ctx.db, ctx.user.id, 'PASSWORD_CHANGED', 'user', ctx.user.id)
}

function validatePassword(pw: string): void {
  if (pw.length < 6) throw new AppError('PASSWORD_TOO_SHORT', { min: 6 })
}

export function setLanguage(ctx: Ctx, language: 'fr' | 'ar'): void {
  ctx.db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, ctx.user.id)
}

// ---------------- User management (admin) ----------------

export const userInputSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  fullName: z.string().trim().min(2).max(100),
  role: z.enum(['ADMIN', 'CASHIER']),
  active: z.boolean(),
  password: z.string().optional()
})

export function listUsers(db: DB) {
  const rows = db.prepare(`${USER_SELECT} ORDER BY u.id`).all() as UserRow[]
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role_code,
    active: !!u.active,
    mustChangePassword: !!u.must_change_password,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at
  }))
}

function roleId(db: DB, code: RoleCode): number {
  return (db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as { id: number }).id
}

function activeAdminCount(db: DB, excludeId?: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.active = 1 AND u.id <> ?`
      )
      .get(excludeId ?? -1) as { c: number }
  ).c
}

export function saveUser(ctx: Ctx, id: number | null, raw: unknown) {
  const input = userInputSchema.parse(raw)
  const db = ctx.db
  const now = nowIso()
  return db.transaction(() => {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(input.username, id ?? -1)
    if (dup) throw new AppError('USERNAME_EXISTS')
    if (id === null) {
      if (!input.password) throw new AppError('PASSWORD_REQUIRED')
      validatePassword(input.password)
      const r = db
        .prepare(
          `INSERT INTO users (username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(input.username, input.fullName, hashPassword(input.password), roleId(db, input.role), input.active ? 1 : 0, now, now)
      audit(db, ctx.user.id, 'USER_CREATED', 'user', Number(r.lastInsertRowid), { username: input.username, role: input.role })
      return Number(r.lastInsertRowid)
    }
    const existing = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserRow | undefined
    if (!existing) throw new AppError('NOT_FOUND')
    const demotingAdmin = existing.role_code === 'ADMIN' && (input.role !== 'ADMIN' || !input.active)
    if (demotingAdmin && activeAdminCount(db, id) === 0) throw new AppError('LAST_ADMIN')
    if (id === ctx.user.id && !input.active) throw new AppError('CANNOT_DISABLE_SELF')
    db.prepare('UPDATE users SET username = ?, full_name = ?, role_id = ?, active = ?, updated_at = ? WHERE id = ?').run(
      input.username,
      input.fullName,
      roleId(db, input.role),
      input.active ? 1 : 0,
      now,
      id
    )
    if (input.password) {
      validatePassword(input.password)
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(input.password), id)
      audit(db, ctx.user.id, 'USER_PASSWORD_RESET', 'user', id)
    }
    audit(db, ctx.user.id, 'USER_UPDATED', 'user', id, { username: input.username, role: input.role, active: input.active })
    return id
  })()
}

export function getRolePermissions(db: DB) {
  return { ADMIN: [...PERMISSIONS], CASHIER: rolePermissions(db, 'CASHIER'), all: [...PERMISSIONS] }
}

export function setCashierPermissions(ctx: Ctx, perms: string[]): void {
  const valid = perms.filter(isPermission)
  const forbiddenForCashier: Permission[] = ['users.manage', 'settings.manage', 'backup.manage']
  const db = ctx.db
  db.transaction(() => {
    const rid = roleId(db, 'CASHIER')
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(rid)
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
    for (const p of valid) if (!forbiddenForCashier.includes(p)) ins.run(rid, p)
    audit(db, ctx.user.id, 'ROLE_PERMISSIONS_UPDATED', 'role', rid, { permissions: valid })
  })()
}

export function listAuditLogs(db: DB, opts: { limit?: number; userId?: number; action?: string; from?: string; to?: string }) {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.userId) {
    where.push('a.user_id = ?')
    params.push(opts.userId)
  }
  if (opts.action) {
    where.push('a.action = ?')
    params.push(opts.action)
  }
  if (opts.from) {
    where.push('a.created_at >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    where.push('a.created_at < ?')
    params.push(opts.to)
  }
  const sql = `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.details, a.created_at AS createdAt,
      u.username, u.full_name AS fullName
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC LIMIT ?`
  params.push(Math.min(opts.limit ?? 300, 2000))
  return db.prepare(sql).all(...params) as {
    id: number
    action: string
    entity: string | null
    entityId: number | null
    details: string | null
    createdAt: string
    username: string | null
    fullName: string | null
  }[]
}

