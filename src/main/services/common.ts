import type { DB } from '../db/connection'
import type { Permission, RoleCode } from '@shared/permissions'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsSection } from '@shared/settings'

/** Business error with a translatable code (renderer maps to `errors.<code>`). */
export class AppError extends Error {
  constructor(
    public code: string,
    public params: Record<string, string | number> = {}
  ) {
    super(code)
    this.name = 'AppError'
  }
}

export interface SessionUser {
  id: number
  username: string
  fullName: string
  role: RoleCode
  permissions: Permission[]
  mustChangePassword: boolean
  language: 'fr' | 'ar'
}

export interface Ctx {
  db: DB
  user: SessionUser
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function hasPerm(user: SessionUser, perm: Permission): boolean {
  return user.role === 'ADMIN' || user.permissions.includes(perm)
}

export function requirePerm(user: SessionUser, perm: Permission): void {
  if (!hasPerm(user, perm)) throw new AppError('FORBIDDEN', { permission: perm })
}

/** Atomically increments and returns the next value of a named sequence. Must run inside a transaction. */
export function nextSequence(db: DB, name: string): number {
  db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, 0)').run(name)
  const row = db.prepare('UPDATE sequences SET value = value + 1 WHERE name = ? RETURNING value').get(name) as {
    value: number
  }
  return row.value
}

export function audit(
  db: DB,
  userId: number | null,
  action: string,
  entity?: string | null,
  entityId?: number | null,
  details?: unknown
): void {
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, action, entity ?? null, entityId ?? null, details === undefined ? null : JSON.stringify(details), nowIso())
}

export function getSettings(db: DB): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const out = {} as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsSection[]) {
    let stored: Record<string, unknown> = {}
    try {
      stored = map.has(key) ? JSON.parse(map.get(key)!) : {}
    } catch {
      stored = {}
    }
    out[key] = { ...DEFAULT_SETTINGS[key], ...stored }
  }
  return out as AppSettings
}

export function getSetting<K extends SettingsSection>(db: DB, key: K): AppSettings[K] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  let stored = {}
  try {
    stored = row ? JSON.parse(row.value) : {}
  } catch {
    stored = {}
  }
  return { ...DEFAULT_SETTINGS[key], ...stored }
}

/** Escapes LIKE wildcards in a user search term. */
export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
}

/** Returns local-day ISO boundaries [start, end) for a YYYY-MM-DD date in the machine timezone. */
export function dayRange(dateFrom: string, dateTo?: string): { from: string; to: string } {
  const start = new Date(`${dateFrom}T00:00:00`)
  const endBase = new Date(`${dateTo ?? dateFrom}T00:00:00`)
  endBase.setDate(endBase.getDate() + 1)
  return { from: start.toISOString(), to: endBase.toISOString() }
}

export function localDateString(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

