/**
 * Role-based permissions. Permission codes are stored in DB (permissions table)
 * and attached to roles via role_permissions. ADMIN always has every permission.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'dashboard.financial',
  'pos.sell',
  'pos.discount',
  'pos.price_override',
  'pos.credit_sale',
  'pos.return',
  'pos.reprint',
  'products.view',
  'products.manage',
  'products.prices',
  'categories.manage',
  'stock.view',
  'stock.manage',
  'purchases.manage',
  'suppliers.manage',
  'customers.view',
  'customers.manage',
  'credits.view',
  'credits.collect',
  'expenses.view',
  'expenses.manage',
  'barcodes.manage',
  'reports.view',
  'users.manage',
  'settings.manage',
  'backup.manage',
  'cash.open_close',
  'cash.close_any',
  'audit.view'
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type RoleCode = 'ADMIN' | 'CASHIER'

export const DEFAULT_CASHIER_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'pos.sell',
  'pos.discount',
  'pos.credit_sale',
  'pos.reprint',
  'products.view',
  'stock.view',
  'customers.view',
  'customers.manage',
  'credits.view',
  'credits.collect',
  'cash.open_close'
]

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v)
}

