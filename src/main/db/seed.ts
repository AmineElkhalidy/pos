import type Database from 'better-sqlite3'
import { PERMISSIONS, DEFAULT_CASHIER_PERMISSIONS } from '@shared/permissions'
import { UNITS } from '@shared/units'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { hashPassword } from '../services/password'

export const INITIAL_ADMIN = { username: 'admin', password: 'admin123' }

/**
 * Idempotent reference-data seed. Inserts only missing rows, never overwrites
 * user changes. Does NOT insert any business data (products, sales...).
 */
export function seedDatabase(db: Database.Database): void {
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO roles (id, code, name) VALUES (1, 'ADMIN', 'Administrateur'), (2, 'CASHIER', 'Caissier')`).run()

    const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (code) VALUES (?)')
    for (const p of PERMISSIONS) insPerm.run(p)

    // Admin always gets all permissions (also enforced in code).
    const insRp = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
    for (const p of PERMISSIONS) insRp.run(1, p)
    // Cashier defaults only on first seed (do not re-add perms an admin removed).
    const cashierSeeded = db.prepare(`SELECT value FROM sequences WHERE name = 'seed_cashier_perms'`).get()
    if (!cashierSeeded) {
      for (const p of DEFAULT_CASHIER_PERMISSIONS) insRp.run(2, p)
      db.prepare(`INSERT INTO sequences (name, value) VALUES ('seed_cashier_perms', 1)`).run()
    }

    const insUnit = db.prepare(
      'INSERT OR IGNORE INTO units (code, dimension, factor, decimals, name_fr, name_ar) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const u of Object.values(UNITS)) insUnit.run(u.code, u.dimension, u.factor, u.decimals, u.nameFr, u.nameAr)

    const insPm = db.prepare(
      'INSERT OR IGNORE INTO payment_methods (code, name_fr, name_ar, is_cash, builtin, sort) VALUES (?, ?, ?, ?, 1, ?)'
    )
    insPm.run('CASH', 'Espèces', 'نقدا', 1, 1)
    insPm.run('CARD', 'Carte bancaire', 'بطاقة بنكية', 0, 2)
    insPm.run('CHEQUE', 'Chèque', 'شيك', 0, 3)
    insPm.run('TRANSFER', 'Virement', 'تحويل بنكي', 0, 4)

    const insEc = db.prepare('INSERT OR IGNORE INTO expense_categories (code, name_fr, name_ar) VALUES (?, ?, ?)')
    insEc.run('ELECTRICITY', 'Électricité', 'الكهرباء')
    insEc.run('WATER', 'Eau', 'الماء')
    insEc.run('RENT', 'Loyer', 'الكراء')
    insEc.run('TRANSPORT', 'Transport', 'النقل')
    insEc.run('MAINTENANCE', 'Maintenance', 'الصيانة')
    insEc.run('SALARIES', 'Salaires', 'الأجور')
    insEc.run('MISC', 'Divers', 'متفرقات')

    const insSeq = db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, 0)')
    for (const s of ['invoice', 'return', 'customer_receipt', 'purchase', 'ean_internal', 'code128_internal']) insSeq.run(s)

    const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v))

    const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
    if (userCount === 0) {
      db.prepare(
        `INSERT INTO users (username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, 1, ?, ?)`
      ).run(INITIAL_ADMIN.username, 'Administrateur', hashPassword(INITIAL_ADMIN.password), now, now)
    }
  })()
}

