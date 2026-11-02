import type Database from 'better-sqlite3'

/**
 * Versioned SQL migrations. NEVER edit a migration that has shipped:
 * append a new entry instead. Each migration runs inside a transaction.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'fr',
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE units (
  code TEXT PRIMARY KEY,
  dimension TEXT NOT NULL CHECK (dimension IN ('count','mass','volume')),
  factor INTEGER NOT NULL,
  decimals INTEGER NOT NULL,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name_fr TEXT NOT NULL,
  name_ar TEXT,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_categories_name ON categories(name_fr COLLATE NOCASE);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name_fr TEXT NOT NULL,
  name_ar TEXT,
  sku TEXT UNIQUE COLLATE NOCASE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit_code TEXT NOT NULL REFERENCES units(code),
  product_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (product_type IN ('standard','weight','volume','pack','variable')),
  purchase_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_cents >= 0),
  avg_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_cents >= 0),
  sale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
  min_sale_price_cents INTEGER CHECK (min_sale_price_cents IS NULL OR min_sale_price_cents >= 0),
  stock_milli INTEGER NOT NULL DEFAULT 0,
  min_stock_milli INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  image_path TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_products_category ON products(category_id);
CREATE INDEX ix_products_name ON products(name_fr COLLATE NOCASE);
CREATE INDEX ix_products_active ON products(active, archived);

CREATE TABLE product_barcodes (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_barcodes_product ON product_barcodes(product_id);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  credit_limit_cents INTEGER CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_customers_name ON customers(name COLLATE NOCASE);
CREATE INDEX ix_customers_phone ON customers(phone);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE payment_methods (
  code TEXT PRIMARY KEY,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  is_cash INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cash_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TEXT NOT NULL,
  opening_cents INTEGER NOT NULL CHECK (opening_cents >= 0),
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id),
  expected_cents INTEGER,
  counted_cents INTEGER,
  difference_cents INTEGER,
  notes TEXT
);
CREATE INDEX ix_cash_sessions_user ON cash_sessions(user_id, status);
CREATE UNIQUE INDEX ux_cash_sessions_one_open_per_user ON cash_sessions(user_id) WHERE status = 'open';

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  subtotal_cents INTEGER NOT NULL,
  lines_discount_cents INTEGER NOT NULL DEFAULT 0,
  cart_discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  tendered_cents INTEGER NOT NULL DEFAULT 0,
  change_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  returned_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','partially_returned','returned')),
  notes TEXT,
  CHECK (paid_cents + credit_cents = total_cents)
);
CREATE INDEX ix_sales_created ON sales(created_at);
CREATE INDEX ix_sales_customer ON sales(customer_id);
CREATE INDEX ix_sales_user ON sales(user_id);
CREATE INDEX ix_sales_session ON sales(session_id);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_code TEXT NOT NULL REFERENCES units(code),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  entry_qty TEXT,
  entry_unit TEXT,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  gross_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  returned_milli INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_sale_items_sale ON sale_items(sale_id);
CREATE INDEX ix_sale_items_product ON sale_items(product_id);

CREATE TABLE sale_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method_code TEXT NOT NULL REFERENCES payment_methods(code),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX ix_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE sale_returns (
  id INTEGER PRIMARY KEY,
  return_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  total_cents INTEGER NOT NULL,
  cash_refund_cents INTEGER NOT NULL DEFAULT 0,
  debt_reduction_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT
);
CREATE INDEX ix_sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX ix_sale_returns_created ON sale_returns(created_at);

CREATE TABLE sale_return_items (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  amount_cents INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL
);

CREATE TABLE customer_payments (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method_code TEXT NOT NULL REFERENCES payment_methods(code),
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  notes TEXT
);
CREATE INDEX ix_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX ix_customer_payments_created ON customer_payments(created_at);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_invoice_no TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
  order_date TEXT NOT NULL,
  received_at TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0,
  returned_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_purchases_supplier ON purchases(supplier_id);
CREATE INDEX ix_purchases_date ON purchases(order_date);

CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  total_cents INTEGER NOT NULL,
  expiry_date TEXT,
  returned_milli INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX ix_purchase_items_product ON purchase_items(product_id);

CREATE TABLE purchase_payments (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method_code TEXT NOT NULL REFERENCES payment_methods(code),
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  notes TEXT
);
CREATE INDEX ix_purchase_payments_purchase ON purchase_payments(purchase_id);

CREATE TABLE purchase_returns (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total_cents INTEGER NOT NULL,
  reason TEXT
);

CREATE TABLE purchase_return_items (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  amount_cents INTEGER NOT NULL
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','ADJUSTMENT','INITIAL_STOCK','DAMAGE','EXPIRATION','INVENTORY')),
  qty_milli INTEGER NOT NULL CHECK (qty_milli <> 0),
  balance_after_milli INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX ix_stock_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX ix_stock_movements_created ON stock_movements(created_at);
CREATE INDEX ix_stock_movements_ref ON stock_movements(ref_type, ref_id);

CREATE TABLE inventory_counts (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','finalized','cancelled')),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  notes TEXT
);

CREATE TABLE inventory_count_items (
  id INTEGER PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  expected_milli INTEGER NOT NULL,
  counted_milli INTEGER,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (count_id, product_id)
);

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  expense_date TEXT NOT NULL,
  method_code TEXT NOT NULL REFERENCES payment_methods(code),
  notes TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES cash_sessions(id),
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_expenses_date ON expenses(expense_date);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_audit_created ON audit_logs(created_at);
CREATE INDEX ix_audit_user ON audit_logs(user_id);

CREATE TABLE backup_history (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  destination_type TEXT NOT NULL CHECK (destination_type IN ('local','usb','auto','pre_restore','custom')),
  size_bytes INTEGER,
  sha256 TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success','failed')),
  message TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
`
  }
]

export function runMigrations(db: Database.Database): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )
  const ran: number[] = []
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      )
    })()
    ran.push(m.version)
  }
  return ran
}

export function currentSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  return row.v ?? 0
}

