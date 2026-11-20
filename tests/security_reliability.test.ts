import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, integrityCheck, quickIntegrityCheck, type DB } from '../src/main/db/connection'
import { login, saveUser, setCashierPermissions } from '../src/main/services/users'
import { saveProduct, getProduct, listProducts } from '../src/main/services/products'
import { openSession, closeSession } from '../src/main/services/cash'
import { createSale } from '../src/main/services/sales'
import { saveCustomer, getCustomer } from '../src/main/services/partners'
import { saveExpense, deleteExpense, listExpenseCategories } from '../src/main/services/expenses'
import {
  createBackup,
  verifyBackupFile,
  restoreFromBackup,
  copyVerifiedBackupToUsb,
  isEncryptedBackupBuffer
} from '../src/main/services/backup'
import { getAlertCounts, getDashboardData } from '../src/main/services/reports'
import { initLogger, logger } from '../src/main/services/logger'
import { bumpDataRevision, type Ctx } from '../src/main/services/common'

describe('Smart POS — Security, Data Integrity & Reliability Suite', () => {
  let tempDir: string
  let db: DB
  let adminCtx: Ctx

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'smartpos-sec-'))
    db = openDatabase(join(tempDir, 'sec.sqlite'))
    const admin = login(db, 'admin', 'admin123')
    adminCtx = { db, user: admin }
    openSession(adminCtx, '500.00')
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('enforces database-level immutability on audit_logs (cannot UPDATE or DELETE)', () => {
    const countBefore = (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c
    expect(countBefore).toBeGreaterThan(0)
    const firstId = (db.prepare('SELECT id FROM audit_logs ORDER BY id ASC LIMIT 1').get() as { id: number }).id

    expect(() => {
      db.prepare(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = ?`).run(firstId)
    }).toThrow(/AUDIT_LOGS_IMMUTABLE/)

    expect(() => {
      db.prepare(`DELETE FROM audit_logs WHERE id = ?`).run(firstId)
    }).toThrow(/AUDIT_LOGS_IMMUTABLE/)

    const countAfter = (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c
    expect(countAfter).toBe(countBefore)
  })

  it('prevents duplicate sales when the same idempotencyKey is submitted twice (double-click / retry)', () => {
    const pid = saveProduct(adminCtx, null, {
      nameFr: 'Café Moulu 250g',
      nameAr: 'قهوة مطحونة',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '20',
      salePrice: '30',
      initialStock: '10'
    })

    const key = 'checkout-uuid-12345'
    const first = createSale(adminCtx, {
      items: [{ productId: pid, qty: '2' }],
      payments: [{ method: 'CASH', amount: '60' }],
      idempotencyKey: key
    })
    const duplicate = createSale(adminCtx, {
      items: [{ productId: pid, qty: '2' }],
      payments: [{ method: 'CASH', amount: '60' }],
      idempotencyKey: key
    })

    expect(duplicate.id).toBe(first.id)
    expect(duplicate.invoiceNo).toBe(first.invoiceNo)
    // Stock must only be deducted ONCE (10 - 2 = 8, not 6)
    expect(getProduct(db, pid).stockMilli).toBe(8000)
    const saleCount = (db.prepare('SELECT COUNT(*) AS c FROM sales').get() as { c: number }).c
    expect(saleCount).toBe(1)
  })

  it('uses decimal-safe credit limits and O(1) getCustomer lookup with before/after audit diff', () => {
    const cid = saveCustomer(adminCtx, null, {
      name: 'Client Précis',
      phone: '0612345678',
      creditLimit: '19.99',
      active: true
    })
    const c = getCustomer(db, cid)
    expect(c.creditLimitCents).toBe(1999)

    saveCustomer(adminCtx, cid, {
      name: 'Client Précis',
      phone: '0612345678',
      creditLimit: '100.10',
      active: true
    })
    expect(getCustomer(db, cid).creditLimitCents).toBe(10010)

    const log = db
      .prepare(`SELECT details FROM audit_logs WHERE action = 'CUSTOMER_UPDATED' AND entity_id = ? ORDER BY id DESC LIMIT 1`)
      .get(cid) as { details: string }
    const parsed = JSON.parse(log.details)
    expect(parsed.from.creditLimitCents).toBe(1999)
    expect(parsed.to.creditLimitCents).toBe(10010)
  })

  it('blocks non-admin from editing/deleting expenses in a closed cash session and logs before/after diffs', () => {
    saveUser(adminCtx, null, {
      username: 'caissier_exp',
      fullName: 'Caissier Test',
      role: 'CASHIER',
      active: true,
      password: 'password123'
    })
    setCashierPermissions(adminCtx, ['expenses.view', 'expenses.manage', 'cash.open_close'])
    const cashier = login(db, 'caissier_exp', 'password123')
    const cashierCtx: Ctx = { db, user: cashier }

    const session = openSession(cashierCtx, '100')
    const catId = listExpenseCategories(db)[0].id
    const today = new Date().toISOString().slice(0, 10)
    const expId = saveExpense(cashierCtx, null, {
      description: 'Fournitures bureau',
      categoryId: catId,
      amount: '25.00',
      expenseDate: today,
      method: 'CASH'
    })

    closeSession(cashierCtx, session.id, '75.00')

    // Cashier cannot modify or delete expense tied to closed session
    expect(() =>
      saveExpense(cashierCtx, expId, {
        description: 'Modifié',
        categoryId: catId,
        amount: '10.00',
        expenseDate: today,
        method: 'CASH'
      })
    ).toThrow(/FORBIDDEN/)
    expect(() => deleteExpense(cashierCtx, expId)).toThrow(/FORBIDDEN/)

    // Admin can still audit-adjust if needed, and before/after values are logged
    saveExpense(adminCtx, expId, {
      description: 'Fournitures bureau corrigé',
      categoryId: catId,
      amount: '20.00',
      expenseDate: today,
      method: 'CASH'
    })
    const log = db
      .prepare(`SELECT details FROM audit_logs WHERE action = 'EXPENSE_UPDATED' AND entity_id = ? ORDER BY id DESC LIMIT 1`)
      .get(expId) as { details: string }
    const diff = JSON.parse(log.details)
    expect(diff.from.amountCents).toBe(2500)
    expect(diff.to.amountCents).toBe(2000)
  })

  it('creates AES-256-GCM encrypted backups, rejects tampered backups, copies verified backup to USB, and restores cleanly', async () => {
    const pid = saveProduct(adminCtx, null, {
      nameFr: 'Thé Vert Sultan',
      nameAr: 'شاي أخضر سلطان',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '12',
      salePrice: '18',
      initialStock: '50'
    })

    const localDir = join(tempDir, 'backups-local')
    const usbDir = join(tempDir, 'backups-usb')
    const rec = await createBackup(db, {
      targetDir: localDir,
      destinationType: 'local',
      userId: adminCtx.user.id,
      encrypt: true
    })

    expect(rec.verified).toBe(true)
    expect(rec.filePath.endsWith('.spbak')).toBe(true)
    const rawBytes = readFileSync(rec.filePath)
    expect(isEncryptedBackupBuffer(rawBytes)).toBe(true)
    // Plaintext product name must NOT appear in encrypted backup
    expect(rawBytes.includes(Buffer.from('Thé Vert Sultan', 'utf8'))).toBe(false)

    // Verify encrypted backup succeeds
    const ver = verifyBackupFile(rec.filePath)
    expect(ver.ok).toBe(true)
    expect(ver.encrypted).toBe(true)

    // Tampering a single byte must fail GCM authentication
    const tamperedPath = join(localDir, 'tampered.spbak')
    const tampered = Buffer.from(rawBytes)
    tampered[tampered.length - 10] ^= 0xff
    writeFileSync(tamperedPath, tampered)
    const badVer = verifyBackupFile(tamperedPath)
    expect(badVer.ok).toBe(false)

    // Atomic USB copy & SHA-256 verification
    const usbRec = copyVerifiedBackupToUsb(db, rec, usbDir, adminCtx.user.id)
    expect(usbRec.verified).toBe(true)
    expect(usbRec.sha256).toBe(rec.sha256)
    expect(existsSync(usbRec.filePath)).toBe(true)

    // Mutate DB and restore from encrypted backup
    const tmpPid = saveProduct(adminCtx, null, {
      nameFr: 'Temporaire',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '5',
      salePrice: '10'
    })
    const res = await restoreFromBackup(adminCtx, rec.filePath, localDir)
    expect(existsSync(res.preRestoreBackupPath)).toBe(true)
    expect(getProduct(db, pid).nameFr).toBe('Thé Vert Sultan')
    expect(() => getProduct(db, tmpPid)).toThrow(/PRODUCT_NOT_FOUND/)
    expect(integrityCheck(db).ok).toBe(true)
    expect(quickIntegrityCheck(db).ok).toBe(true)

    // Audit immutability triggers must remain active AFTER restore!
    const anyAudit = db.prepare('SELECT id FROM audit_logs LIMIT 1').get() as { id: number }
    expect(() => db.prepare('DELETE FROM audit_logs WHERE id = ?').run(anyAudit.id)).toThrow(/AUDIT_LOGS_IMMUTABLE/)
  })

  it('invalidates dashboard & alerts cache automatically on writes and supports category search', () => {
    const a1 = getAlertCounts(db)
    const d1 = getDashboardData(db)
    expect(d1.totalProducts).toBe(0)

    saveProduct(adminCtx, null, {
      nameFr: 'Eau Minérale 1.5L',
      nameAr: 'ماء معدني',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '3',
      salePrice: '5',
      initialStock: '0',
      minStock: '5'
    })

    const a2 = getAlertCounts(db)
    const d2 = getDashboardData(db)
    expect(a2.outOfStockCount).toBe(a1.outOfStockCount + 1)
    expect(d2.totalProducts).toBe(1)

    // Manual bumpDataRevision works cleanly
    bumpDataRevision(db)
    const found = listProducts(db, { search: 'ماء', limit: 20 })
    expect(found.total).toBe(1)
  })

  it('redacts sensitive fields in rotating structured logs', () => {
    const logPath = initLogger(tempDir)
    logger.security('auth', 'Test redaction', {
      username: 'admin',
      password: 'SuperSecretPassword123!',
      apiKey: 'sk-123456',
      nested: { secretToken: 'abc-xyz' }
    })
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('admin')
    expect(content).toContain('[REDACTED]')
    expect(content).not.toContain('SuperSecretPassword123!')
    expect(content).not.toContain('sk-123456')
    expect(content).not.toContain('abc-xyz')
  })
})

