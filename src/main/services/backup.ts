import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { DB } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { AppError, audit, getSetting, hasPerm, nowIso, type Ctx } from './common'

export interface BackupRecord {
  id: number
  filePath: string
  destinationType: 'local' | 'usb' | 'auto' | 'pre_restore' | 'custom'
  sizeBytes: number | null
  sha256: string | null
  verified: boolean
  status: 'success' | 'failed'
  message: string | null
  userName: string | null
  createdAt: string
  existsOnDisk: boolean
}

export interface RemovableDrive {
  driveLetter: string
  label: string
  freeBytes: number
  totalBytes: number
  backupPath: string
}

/**
 * Verifies a backup SQLite file by opening it read-only, running PRAGMA integrity_check,
 * and confirming the core schema tables are present.
 */
export function verifyBackupFile(filePath: string): { ok: boolean; sha256: string; sizeBytes: number; message: string } {
  if (!existsSync(filePath)) return { ok: false, sha256: '', sizeBytes: 0, message: 'FILE_NOT_FOUND' }
  const stat = statSync(filePath)
  if (stat.size < 4096) return { ok: false, sha256: '', sizeBytes: stat.size, message: 'FILE_TOO_SMALL' }
  const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex')
  let testDb: Database.Database | null = null
  try {
    testDb = new Database(filePath, { readonly: true, fileMustExist: true })
    const ic = testDb.pragma('integrity_check') as { integrity_check: string }[]
    if (!ic.length || ic[0].integrity_check !== 'ok') {
      return { ok: false, sha256, sizeBytes: stat.size, message: ic.map((x) => x.integrity_check).join('; ') }
    }
    const tables = new Set(
      (testDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name)
    )
    for (const required of ['users', 'products', 'sales', 'stock_movements', 'settings']) {
      if (!tables.has(required)) return { ok: false, sha256, sizeBytes: stat.size, message: `MISSING_TABLE:${required}` }
    }
    return { ok: true, sha256, sizeBytes: stat.size, message: 'OK' }
  } catch (e) {
    return { ok: false, sha256, sizeBytes: stat.size, message: (e as Error).message }
  } finally {
    try {
      testDb?.close()
    } catch {
      // ignore
    }
  }
}

function makeBackupFilename(prefix = 'smartpos-backup'): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}-${iso}.sqlite`
}

/**
 * Uses SQLite's online backup API (`db.backup(destPath)`) which is WAL-safe and consistent
 * even while the database is open. Never performs a raw file copy on a live DB.
 */
export async function createBackup(
  db: DB,
  opts: {
    targetDir: string
    destinationType: 'local' | 'usb' | 'auto' | 'pre_restore' | 'custom'
    userId: number | null
    prefix?: string
  }
): Promise<BackupRecord> {
  mkdirSync(opts.targetDir, { recursive: true })
  const destPath = join(opts.targetDir, makeBackupFilename(opts.prefix ?? `smartpos-${opts.destinationType}`))
  const now = nowIso()
  try {
    // Checkpoint WAL first so the online backup completes quickly and cleanly
    try {
      db.pragma('wal_checkpoint(PASSIVE)')
    } catch {
      // ignore if busy
    }
    await db.backup(destPath)
    const ver = verifyBackupFile(destPath)
    if (!ver.ok) throw new AppError('BACKUP_VERIFICATION_FAILED', { reason: ver.message })
    const r = db
      .prepare(
        `INSERT INTO backup_history (file_path, destination_type, size_bytes, sha256, verified, status, message, user_id, created_at)
         VALUES (?, ?, ?, ?, 1, 'success', ?, ?, ?)`
      )
      .run(destPath, opts.destinationType, ver.sizeBytes, ver.sha256, 'OK', opts.userId, now)
    audit(db, opts.userId, 'BACKUP_CREATED', 'backup', Number(r.lastInsertRowid), {
      destPath,
      destinationType: opts.destinationType,
      sizeBytes: ver.sizeBytes
    })
    pruneOldBackups(db)
    return getBackupRecord(db, Number(r.lastInsertRowid))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    db.prepare(
      `INSERT INTO backup_history (file_path, destination_type, size_bytes, sha256, verified, status, message, user_id, created_at)
       VALUES (?, ?, 0, NULL, 0, 'failed', ?, ?, ?)`
    ).run(destPath, opts.destinationType, msg, opts.userId, now)
    throw e
  }
}

/**
 * Retention policy: keeps at least `keepCount` valid backups AND never deletes the last valid backup.
 */
function pruneOldBackups(db: DB): void {
  const keep = Math.max(3, getSetting(db, 'backup').keepCount || 30)
  const rows = db
    .prepare(
      `SELECT id, file_path FROM backup_history WHERE status = 'success' AND verified = 1 ORDER BY id DESC`
    )
    .all() as { id: number; file_path: string }[]
  const existing = rows.filter((r) => existsSync(r.file_path))
  if (existing.length <= Math.max(1, keep)) return
  // Never touch index 0 (most recent valid backup) or anything within `keep`
  for (const old of existing.slice(keep)) {
    try {
      unlinkSync(old.file_path)
    } catch {
      // ignore if already removed
    }
  }
}

function getBackupRecord(db: DB, id: number): BackupRecord {
  const r = db
    .prepare(
      `SELECT b.id, b.file_path AS filePath, b.destination_type AS destinationType, b.size_bytes AS sizeBytes,
        b.sha256, b.verified, b.status, b.message, u.full_name AS userName, b.created_at AS createdAt
       FROM backup_history b LEFT JOIN users u ON u.id = b.user_id WHERE b.id = ?`
    )
    .get(id) as Omit<BackupRecord, 'verified' | 'existsOnDisk'> & { verified: number }
  return { ...r, verified: !!r.verified, existsOnDisk: existsSync(r.filePath) }
}

export function listBackups(db: DB): BackupRecord[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.file_path AS filePath, b.destination_type AS destinationType, b.size_bytes AS sizeBytes,
        b.sha256, b.verified, b.status, b.message, u.full_name AS userName, b.created_at AS createdAt
       FROM backup_history b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.id DESC LIMIT 200`
    )
    .all() as (Omit<BackupRecord, 'verified' | 'existsOnDisk'> & { verified: number })[]
  return rows.map((r) => ({ ...r, verified: !!r.verified, existsOnDisk: existsSync(r.filePath) }))
}

/**
 * Restores the live database from a verified backup file.
 * 1. Verifies the backup file first.
 * 2. Takes a `pre_restore` safety backup of the current database.
 * 3. Uses SQLite's online backup API from the source backup into a temporary file,
 *    or copies atomically into the live DB connection via SQLite `VACUUM INTO` / table restore.
 *    Specifically, we open the backup DB and use `sourceDb.backup(liveDbPath)` after closing & reopening
 *    through the provided `reopenDb` callback, or if `reopenDb` is not used (in-process), we restore via
 *    attached database copy inside a transaction.
 */
export async function restoreFromBackup(
  ctx: Ctx,
  sourcePath: string,
  safetyBackupDir: string,
  swapLiveDatabase?: (verifiedSourcePath: string) => void
): Promise<{ preRestoreBackupPath: string }> {
  if (!hasPerm(ctx.user, 'backup.manage')) throw new AppError('FORBIDDEN', { permission: 'backup.manage' })
  const ver = verifyBackupFile(sourcePath)
  if (!ver.ok) throw new AppError('BACKUP_INVALID', { reason: ver.message })

  // Always create a pre-restore backup before touching current data
  mkdirSync(safetyBackupDir, { recursive: true })
  const preRestore = await createBackup(ctx.db, {
    targetDir: safetyBackupDir,
    destinationType: 'pre_restore',
    userId: ctx.user.id,
    prefix: 'smartpos-pre-restore'
  })

  if (swapLiveDatabase) {
    swapLiveDatabase(sourcePath)
  } else {
    restoreInPlace(ctx.db, sourcePath)
  }

  runMigrations(ctx.db)
  audit(ctx.db, ctx.user.id, 'BACKUP_RESTORED', 'backup', null, {
    sourcePath,
    preRestoreBackupPath: preRestore.filePath
  })
  return { preRestoreBackupPath: preRestore.filePath }
}

/**
 * In-place transactional restore using `ATTACH DATABASE`: copies every table from the verified
 * backup into the open connection without needing to close the handle.
 */
export function restoreInPlace(db: DB, sourcePath: string): void {
  const escaped = sourcePath.replace(/'/g, "''")
  db.pragma('foreign_keys = OFF')
  db.exec(`ATTACH DATABASE '${escaped}' AS restore_src`)
  try {
    const tables = (
      db
        .prepare(
          `SELECT name FROM restore_src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as { name: string }[]
    ).map((r) => r.name)
    const currentTables = new Set(
      (db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name)
    )
    db.transaction(() => {
      for (const t of tables) {
        if (!currentTables.has(t)) continue
        // Preserve backup_history so the pre-restore backup record remains visible
        if (t === 'backup_history') continue
        db.exec(`DELETE FROM main."${t}"`)
        db.exec(`INSERT INTO main."${t}" SELECT * FROM restore_src."${t}"`)
      }
    })()
  } finally {
    db.exec('DETACH DATABASE restore_src')
    db.pragma('foreign_keys = ON')
  }
  const fk = db.pragma('foreign_key_check') as unknown[]
  if (fk.length > 0) throw new AppError('RESTORE_FK_ERROR')
}

/** Detects removable USB drives on Windows using PowerShell/CIM (DriveType = 2). */
export function detectRemovableDrives(): RemovableDrive[] {
  if (process.platform !== 'win32') return []
  try {
    const ps = `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Json -Compress`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true
    }).trim()
    if (!out) return []
    const parsed = JSON.parse(out)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .filter((d) => d && d.DeviceID)
      .map((d) => ({
        driveLetter: String(d.DeviceID),
        label: String(d.VolumeName || 'USB'),
        freeBytes: Number(d.FreeSpace || 0),
        totalBytes: Number(d.Size || 0),
        backupPath: join(`${d.DeviceID}\\`, 'SmartPOS-Backups')
      }))
  } catch {
    return []
  }
}

export function defaultBackupDirectory(userDataDir: string): string {
  const configured = join(dirname(userDataDir), 'SmartPOS', 'backups')
  return existsSync(userDataDir) ? join(userDataDir, 'backups') : configured
}

