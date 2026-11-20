import Database from 'better-sqlite3'
import { runMigrations } from './migrations'
import { seedDatabase } from './seed'

export type DB = Database.Database

/**
 * Opens (or creates) the SQLite database with safe & high-performance pragmas:
 *  - WAL journal for crash safety + concurrent reads
 *  - synchronous=FULL so committed transactions survive power loss
 *  - foreign keys enforced
 *  - 64 MB page cache, in-memory temp tables, 256 MB mmap for large datasets
 */
export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -64000')
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456')
  db.pragma('wal_autocheckpoint = 1000')
  runMigrations(db)
  seedDatabase(db)
  return db
}

export function closeDatabase(db: DB): void {
  try {
    db.pragma('optimize')
  } catch {
    // ignore
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // ignore
  }
  db.close()
}

export function quickIntegrityCheck(db: DB): { ok: boolean; messages: string[] } {
  const rows = db.pragma('quick_check') as { quick_check: string }[]
  const messages = rows.map((r) => r.quick_check)
  const ok = messages.length === 1 && messages[0] === 'ok'
  return { ok, messages }
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

