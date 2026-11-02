import { settingsSchema, type AppSettings, type SettingsSection } from '@shared/settings'
import { AppError, audit, getSettings, hasPerm, type Ctx } from './common'

export function updateSettings(ctx: Ctx, partial: Partial<AppSettings>): AppSettings {
  if (!hasPerm(ctx.user, 'settings.manage')) throw new AppError('FORBIDDEN', { permission: 'settings.manage' })
  const current = getSettings(ctx.db)
  const merged: AppSettings = {
    store: { ...current.store, ...(partial.store ?? {}) },
    general: { ...current.general, ...(partial.general ?? {}) },
    sales: { ...current.sales, ...(partial.sales ?? {}) },
    receipt: { ...current.receipt, ...(partial.receipt ?? {}) },
    labels: { ...current.labels, ...(partial.labels ?? {}) },
    scale: { ...current.scale, ...(partial.scale ?? {}) },
    stock: { ...current.stock, ...(partial.stock ?? {}) },
    backup: { ...current.backup, ...(partial.backup ?? {}) }
  }
  const validated = settingsSchema.parse(merged)
  const db = ctx.db
  db.transaction(() => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    for (const key of Object.keys(validated) as SettingsSection[]) {
      up.run(key, JSON.stringify(validated[key]))
    }
    audit(db, ctx.user.id, 'SETTINGS_UPDATED', 'settings', null, Object.keys(partial))
  })()
  return validated
}

