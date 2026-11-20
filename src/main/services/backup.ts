import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import type { DB } from '../db/connection'
import { runMigrations } from '../db/migrations'
import { AppError, audit, getSetting, hasPerm, invalidateSettingsCache, nowIso, type Ctx } from './common'
import { logger } from './logger'

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

// ======================= AES-256-GCM Backup Encryption =======================

const ENC_MAGIC = Buffer.from('SPBAK1', 'ascii') // 6 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = ENC_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN

let configuredKeyPath: string | null = null
let fallbackSessionKey: string | null = null

export function configureBackupKeyPath(keyFilePath: string): void {
  configuredKeyPath = keyFilePath
}

function getBackupSecret(overrideSecret?: string): string {
  if (overrideSecret) return overrideSecret
  if (process.env.SMARTPOS_BACKUP_KEY) return process.env.SMARTPOS_BACKUP_KEY
  if (configuredKeyPath) {
    if (existsSync(configuredKeyPath)) {
      const existing = readFileSync(configuredKeyPath, 'utf8').trim()
      if (existing.length >= 32) return existing
    }
    mkdirSync(dirname(configuredKeyPath), { recursive: true })
    const generated = randomBytes(32).toString('hex')
    writeFileSync(configuredKeyPath, generated, { encoding: 'utf8', mode: 0o600 })
    return generated
  }
  if (!fallbackSessionKey) {
    fallbackSessionKey = randomBytes(32).toString('hex')
  }
  return fallbackSessionKey
}

export function isEncryptedBackupBuffer(buf: Buffer): boolean {
  return buf.length > HEADER_LEN && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)
}

export function encryptBackupBuffer(plain: Buffer, secret?: string): Buffer {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = scryptSync(getBackupSecret(secret), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([ENC_MAGIC, salt, iv, tag, encrypted])
}

export function decryptBackupBuffer(enc: Buffer, secret?: string): Buffer {
  if (!isEncryptedBackupBuffer(enc)) throw new Error('NOT_ENCRYPTED_BACKUP')
  let offset = ENC_MAGIC.length
  const salt = enc.subarray(offset, offset + SALT_LEN)
  offset += SALT_LEN
  const iv = enc.subarray(offset, offset + IV_LEN)
  offset += IV_LEN
  const tag = enc.subarray(offset, offset + TAG_LEN)
  offset += TAG_LEN
  const ciphertext = enc.subarray(offset)
  const key = scryptSync(getBackupSecret(secret), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function safeUnlink(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    // ignore cleanup error
  }
}

function verifySqliteFile(sqlitePath: string): { ok: boolean; message: string } {
  let testDb: Database.Database | null = null
  try {
    testDb = new Database(sqlitePath, { readonly: true, fileMustExist: true })
    const ic = testDb.pragma('integrity_check') as { integrity_check: string }[]
    if (!ic.length || ic[0].integrity_check !== 'ok') {
      return { ok: false, message: ic.map((x) => x.integrity_check).join('; ') }
    }
    const tables = new Set(
      (testDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name)
    )
    for (const required of ['users', 'products', 'sales', 'stock_movements', 'settings']) {
      if (!tables.has(required)) return { ok: false, message: `MISSING_TABLE:${required}` }
    }
    return { ok: true, message: 'OK' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  } finally {
    try {
      testDb?.close()
    } catch {
      // ignore
    }
  }
}

/**
 * Verifies a backup file (encrypted `.spbak` or legacy plain `.sqlite`) by checking
 * AES-256-GCM authentication (if encrypted), opening read-only, running PRAGMA integrity_check,
 * and confirming all core schema tables are present.
 */
export function verifyBackupFile(
  filePath: string,
  secret?: string
): { ok: boolean; sha256: string; sizeBytes: number; encrypted: boolean; message: string } {
  if (!existsSync(filePath)) return { ok: false, sha256: '', sizeBytes: 0, encrypted: false, message: 'FILE_NOT_FOUND' }
  const stat = statSync(filePath)
  if (stat.size < 4096) return { ok: false, sha256: '', sizeBytes: stat.size, encrypted: false, message: 'FILE_TOO_SMALL' }
  const raw = readFileSync(filePath)
  const sha256 = createHash('sha256').update(raw).digest('hex')

  if (isEncryptedBackupBuffer(raw)) {
    const tmpDec = join(tmpdir(), `smartpos-verify-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`)
    try {
      const plain = decryptBackupBuffer(raw, secret)
      writeFileSync(tmpDec, plain)
      const res = verifySqliteFile(tmpDec)
      return { ok: res.ok, sha256, sizeBytes: stat.size, encrypted: true, message: res.message }
    } catch (e) {
      return { ok: false, sha256, sizeBytes: stat.size, encrypted: true, message: `DECRYPT_FAILED:${(e as Error).message}` }
    } finally {
      safeUnlink(tmpDec)
    }
  }

  const res = verifySqliteFile(filePath)
  return { ok: res.ok, sha256, sizeBytes: stat.size, encrypted: false, message: res.message }
}

function makeBackupFilename(prefix = 'smartpos-backup', encrypted = true): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const ext = encrypted ? 'spbak' : 'sqlite'
  return `${prefix}-${iso}.${ext}`
}

/**
 * Uses SQLite's online backup API (`db.backup(tmpPath)`) which is WAL-safe and consistent
 * even while the database is open. Optionally encrypts with AES-256-GCM and verifies the
 * final output file before reporting success.
 */
export async function createBackup(
  db: DB,
  opts: {
    targetDir: string
    destinationType: 'local' | 'usb' | 'auto' | 'pre_restore' | 'custom'
    userId: number | null
    prefix?: string
    encrypt?: boolean
    secret?: string
  }
): Promise<BackupRecord> {
  mkdirSync(opts.targetDir, { recursive: true })
  const shouldEncrypt = opts.encrypt ?? getSetting(db, 'backup').encryptBackups ?? true
  const destPath = join(opts.targetDir, makeBackupFilename(opts.prefix ?? `smartpos-${opts.destinationType}`, shouldEncrypt))
  const tmpSqlite = join(tmpdir(), `smartpos-bak-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`)
  const tmpDest = `${destPath}.tmp`
  const now = nowIso()
  try {
    try {
      db.pragma('wal_checkpoint(PASSIVE)')
    } catch {
      // ignore if busy
    }
    await db.backup(tmpSqlite)
    const rawVer = verifySqliteFile(tmpSqlite)
    if (!rawVer.ok) throw new AppError('BACKUP_VERIFICATION_FAILED', { reason: rawVer.message })

    if (shouldEncrypt) {
      const plain = readFileSync(tmpSqlite)
      const enc = encryptBackupBuffer(plain, opts.secret)
      writeFileSync(tmpDest, enc)
      renameSync(tmpDest, destPath)
    } else {
      copyFileSync(tmpSqlite, tmpDest)
      renameSync(tmpDest, destPath)
    }

    const ver = verifyBackupFile(destPath, opts.secret)
    if (!ver.ok) {
      safeUnlink(destPath)
      throw new AppError('BACKUP_VERIFICATION_FAILED', { reason: ver.message })
    }
    const r = db
      .prepare(
        `INSERT INTO backup_history (file_path, destination_type, size_bytes, sha256, verified, status, message, user_id, created_at)
         VALUES (?, ?, ?, ?, 1, 'success', ?, ?, ?)`
      )
      .run(destPath, opts.destinationType, ver.sizeBytes, ver.sha256, ver.encrypted ? 'OK (AES-256-GCM)' : 'OK', opts.userId, now)
    audit(db, opts.userId, 'BACKUP_CREATED', 'backup', Number(r.lastInsertRowid), {
      destPath,
      destinationType: opts.destinationType,
      sizeBytes: ver.sizeBytes,
      encrypted: ver.encrypted
    })
    pruneOldBackups(db)
    logger.info('backup', 'Backup created and verified', { destPath, destinationType: opts.destinationType, sizeBytes: ver.sizeBytes })
    return getBackupRecord(db, Number(r.lastInsertRowid))
  } catch (e) {
    safeUnlink(tmpDest)
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('backup', 'Backup failed', { destPath, destinationType: opts.destinationType, error: msg })
    db.prepare(
      `INSERT INTO backup_history (file_path, destination_type, size_bytes, sha256, verified, status, message, user_id, created_at)
       VALUES (?, ?, 0, NULL, 0, 'failed', ?, ?, ?)`
    ).run(destPath, opts.destinationType, msg, opts.userId, now)
    throw e
  } finally {
    safeUnlink(tmpSqlite)
  }
}

/**
 * Atomically copies an already-verified local backup to a connected USB drive and verifies SHA-256.
 */
export function copyVerifiedBackupToUsb(
  db: DB,
  sourceRecord: BackupRecord,
  usbDir: string,
  userId: number | null
): BackupRecord {
  mkdirSync(usbDir, { recursive: true })
  const destPath = join(usbDir, basename(sourceRecord.filePath))
  const tmpDest = `${destPath}.tmp`
  const now = nowIso()
  try {
    copyFileSync(sourceRecord.filePath, tmpDest)
    const copiedBuf = readFileSync(tmpDest)
    const copiedSha = createHash('sha256').update(copiedBuf).digest('hex')
    if (sourceRecord.sha256 && copiedSha !== sourceRecord.sha256) {
      throw new AppError('BACKUP_VERIFICATION_FAILED', { reason: 'USB_SHA256_MISMATCH' })
    }
    renameSync(tmpDest, destPath)
    const r = db
      .prepare(
        `INSERT INTO backup_history (file_path, destination_type, size_bytes, sha256, verified, status, message, user_id, created_at)
         VALUES (?, 'usb', ?, ?, 1, 'success', 'OK (USB copy verified)', ?, ?)`
      )
      .run(destPath, copiedBuf.length, copiedSha, userId, now)
    audit(db, userId, 'BACKUP_USB_COPIED', 'backup', Number(r.lastInsertRowid), { destPath, sizeBytes: copiedBuf.length })
    return getBackupRecord(db, Number(r.lastInsertRowid))
  } catch (e) {
    safeUnlink(tmpDest)
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('backup', 'USB backup copy failed', { destPath, error: msg })
    db.prepare(
      `INSERT INTO backup_history (file_path, destination_type, size_bytes, sha256, verified, status, message, user_id, created_at)
       VALUES (?, 'usb', 0, NULL, 0, 'failed', ?, ?, ?)`
    ).run(destPath, msg, userId, now)
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
  for (const old of existing.slice(keep)) {
    safeUnlink(old.file_path)
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
 * Restores the live database from a verified backup file (encrypted `.spbak` or plain `.sqlite`).
 * 1. Verifies the backup file first.
 * 2. Takes a `pre_restore` safety backup of the current database.
 * 3. Restores transactionally and runs migrations + integrity checks.
 */
export async function restoreFromBackup(
  ctx: Ctx,
  sourcePath: string,
  safetyBackupDir: string,
  swapLiveDatabase?: (verifiedSourcePath: string) => void,
  secret?: string
): Promise<{ preRestoreBackupPath: string }> {
  if (!hasPerm(ctx.user, 'backup.manage')) throw new AppError('FORBIDDEN', { permission: 'backup.manage' })
  const ver = verifyBackupFile(sourcePath, secret)
  if (!ver.ok) throw new AppError('BACKUP_INVALID', { reason: ver.message })

  mkdirSync(safetyBackupDir, { recursive: true })
  const preRestore = await createBackup(ctx.db, {
    targetDir: safetyBackupDir,
    destinationType: 'pre_restore',
    userId: ctx.user.id,
    prefix: 'smartpos-pre-restore',
    secret
  })

  if (swapLiveDatabase) {
    swapLiveDatabase(sourcePath)
  } else {
    restoreInPlace(ctx.db, sourcePath, secret)
  }

  runMigrations(ctx.db)
  invalidateSettingsCache(ctx.db)
  audit(ctx.db, ctx.user.id, 'BACKUP_RESTORED', 'backup', null, {
    sourcePath,
    preRestoreBackupPath: preRestore.filePath
  })
  logger.security('backup', 'Database restored from backup', {
    userId: ctx.user.id,
    sourcePath,
    preRestoreBackupPath: preRestore.filePath
  })
  return { preRestoreBackupPath: preRestore.filePath }
}

/**
 * In-place transactional restore using `ATTACH DATABASE`: copies every table from the verified
 * backup into the open connection without needing to close the handle.
 * Handles encrypted `.spbak` files via temporary decryption and temporarily pauses
 * `audit_logs` immutability triggers strictly during the verified Admin restore.
 */
export function restoreInPlace(db: DB, sourcePath: string, secret?: string): void {
  const raw = readFileSync(sourcePath)
  let attachPath = sourcePath
  let tmpDec: string | null = null
  if (isEncryptedBackupBuffer(raw)) {
    tmpDec = join(tmpdir(), `smartpos-restore-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`)
    writeFileSync(tmpDec, decryptBackupBuffer(raw, secret))
    attachPath = tmpDec
  }

  const escaped = attachPath.replace(/'/g, "''")
  db.pragma('foreign_keys = OFF')
  db.exec(`ATTACH DATABASE '${escaped}' AS restore_src`)
  try {
    const tables = (
      db
        .prepare(`SELECT name FROM restore_src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[]
    ).map((r) => r.name)
    const currentTables = new Set(
      (db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name)
    )
    db.exec('DROP TRIGGER IF EXISTS main.trg_audit_logs_no_update')
    db.exec('DROP TRIGGER IF EXISTS main.trg_audit_logs_no_delete')
    db.transaction(() => {
      for (const t of tables) {
        if (!currentTables.has(t)) continue
        if (t === 'backup_history') continue
        db.exec(`DELETE FROM main."${t}"`)
        // Match common columns so older backups restore cleanly into newer schemas
        const srcCols = (db.prepare(`PRAGMA restore_src.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name)
        const dstCols = new Set((db.prepare(`PRAGMA main.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name))
        const common = srcCols.filter((c) => dstCols.has(c))
        if (common.length === 0) continue
        const colList = common.map((c) => `"${c}"`).join(', ')
        db.exec(`INSERT INTO main."${t}" (${colList}) SELECT ${colList} FROM restore_src."${t}"`)
      }
    })()
  } finally {
    try {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
        BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'AUDIT_LOGS_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
        BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'AUDIT_LOGS_IMMUTABLE'); END;
      `)
    } catch {
      // ignore
    }
    db.exec('DETACH DATABASE restore_src')
    db.pragma('foreign_keys = ON')
    if (tmpDec) safeUnlink(tmpDec)
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
