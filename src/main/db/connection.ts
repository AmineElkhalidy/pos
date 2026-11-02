import Database from 'better-sqlite3'
import { runMigrations } from './migrations'
import { seedDatabase } from './seed'

export type DB = Database.Database

/**
 * Opens (or creates) the SQLite database with safe pragmas:
 *  - WAL journal for crash safety + concurrent reads
 *  - synchronous=FULL so committed transactions survive power loss
 *  - foreign keys enforced
 */
export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db)
  seedDatabase(db)
  return db
}

/** Wraps a function in an IMMEDIATE transaction (all-or-nothing). */
export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn).immediate()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function integrityCheck(db: DB): { ok: boolean; messages: string[] } {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[]
  const fk = db.pragma('foreign_key_check') as unknown[]
  const messages = rows.map((r) => r.integrity_check)
  const ok = messages.length === 1 && messages[0] === 'ok' && fk.length === 0
  if (fk.length) messages.push(`foreign_key_violations: ${fk.length}`)
  return { ok, messages }
}

