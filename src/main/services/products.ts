import { z } from 'zod'
import Papa from 'papaparse'
import type { DB } from '../db/connection'
import { AppError, audit, getSetting, likeTerm, nextSequence, nowIso, type Ctx } from './common'
import { applyStockMovement } from './stock'
import { toCents, toMilli, fromCents, fromMilli } from '@shared/money'
import { UNIT_CODES, isUnitCode, type UnitCode } from '@shared/units'
import {
  buildInternalCode128,
  buildInternalEan13,
  detectFormat,
  isValidEan13,
  normalizeBarcode,
  type BarcodeFormat
} from '@shared/barcode'

// ======================= Categories =======================

export const categorySchema = z.object({
  nameFr: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().max(80).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  active: z.boolean().default(true)
})

export function listCategories(db: DB) {
  return db
    .prepare(
      `SELECT c.id, c.name_fr AS nameFr, c.name_ar AS nameAr, c.color, c.active,
        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.archived = 0) AS productCount
       FROM categories c ORDER BY c.name_fr COLLATE NOCASE`
    )
    .all()
    .map((r) => {
      const row = r as { id: number; nameFr: string; nameAr: string | null; color: string | null; active: number; productCount: number }
      return { ...row, active: !!row.active }
    })
}

export function saveCategory(ctx: Ctx, id: number | null, raw: unknown) {
  const input = categorySchema.parse(raw)
  const db = ctx.db
  const dup = db.prepare('SELECT id FROM categories WHERE name_fr = ? COLLATE NOCASE AND id <> ?').get(input.nameFr, id ?? -1)
  if (dup) throw new AppError('CATEGORY_EXISTS')
  const now = nowIso()
  if (id === null) {
    const r = db
      .prepare('INSERT INTO categories (name_fr, name_ar, color, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.nameFr, input.nameAr || null, input.color || null, input.active ? 1 : 0, now, now)
    audit(db, ctx.user.id, 'CATEGORY_CREATED', 'category', Number(r.lastInsertRowid), input)
    return Number(r.lastInsertRowid)
  }
  db.prepare('UPDATE categories SET name_fr = ?, name_ar = ?, color = ?, active = ?, updated_at = ? WHERE id = ?').run(
    input.nameFr,
    input.nameAr || null,
    input.color || null,
    input.active ? 1 : 0,
    now,
    id
  )
  audit(db, ctx.user.id, 'CATEGORY_UPDATED', 'category', id, input)
  return id
}

export function deleteCategory(ctx: Ctx, id: number) {
  const db = ctx.db
  const used = (db.prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND archived = 0').get(id) as { c: number }).c
  if (used > 0) throw new AppError('CATEGORY_IN_USE', { count: used })
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  audit(db, ctx.user.id, 'CATEGORY_DELETED', 'category', id)
}

// ======================= Products =======================

export const productTypeEnum = z.enum(['standard', 'weight', 'volume', 'pack', 'variable'])
const decimalInput = z.union([z.string(), z.number()])

export const productSchema = z.object({
  nameFr: z.string().trim().min(1).max(150),
  nameAr: z.string().trim().max(150).optional().nullable(),
  sku: z.string().trim().max(60).optional().nullable(),
  categoryId: z.number().int().positive().optional().nullable(),
  unitCode: z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]),
  productType: productTypeEnum,
  purchasePrice: decimalInput,
  salePrice: decimalInput,
  minSalePrice: decimalInput.optional().nullable(),
  minStock: decimalInput.optional(),
  initialStock: decimalInput.optional(),
  trackExpiry: z.boolean().default(false),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  active: z.boolean().default(true),
  notes: z.string().max(1000).optional().nullable(),
  image: z.string().max(2000000).optional().nullable(),
  barcodes: z.array(z.object({ code: z.string().trim().min(1).max(64), isPrimary: z.boolean().optional() })).default([]),
  generateBarcode: z.enum(['EAN13', 'CODE128']).optional().nullable()
})

export type ProductInput = z.input<typeof productSchema>

export interface ProductRow {
  id: number
  nameFr: string
  nameAr: string | null
  sku: string | null
  categoryId: number | null
  categoryName: string | null
  categoryNameAr: string | null
  unitCode: UnitCode
  productType: z.infer<typeof productTypeEnum>
  purchasePriceCents: number
  avgCostCents: number
  salePriceCents: number
  minSalePriceCents: number | null
  stockMilli: number
  minStockMilli: number
  trackExpiry: boolean
  expiryDate: string | null
  image: string | null
  notes: string | null
  active: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
  barcodes: { id: number; code: string; format: BarcodeFormat; isInternal: boolean; isPrimary: boolean }[]
}

const PRODUCT_SELECT = `SELECT p.id, p.name_fr AS nameFr, p.name_ar AS nameAr, p.sku, p.category_id AS categoryId,
  c.name_fr AS categoryName, c.name_ar AS categoryNameAr, p.unit_code AS unitCode, p.product_type AS productType,
  p.purchase_price_cents AS purchasePriceCents, p.avg_cost_cents AS avgCostCents, p.sale_price_cents AS salePriceCents,
  p.min_sale_price_cents AS minSalePriceCents, p.stock_milli AS stockMilli, p.min_stock_milli AS minStockMilli,
  p.track_expiry AS trackExpiry, p.expiry_date AS expiryDate, p.image_path AS image, p.notes, p.active, p.archived,
  p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`

function hydrate(db: DB, rows: Record<string, unknown>[], withImage = true): ProductRow[] {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id as number)
  const bc = db
    .prepare(
      `SELECT id, product_id AS productId, code, format, is_internal AS isInternal, is_primary AS isPrimary
       FROM product_barcodes WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_primary DESC, id`
    )
    .all(...ids) as { id: number; productId: number; code: string; format: BarcodeFormat; isInternal: number; isPrimary: number }[]
  const byProduct = new Map<number, ProductRow['barcodes']>()
  for (const b of bc) {
    const list = byProduct.get(b.productId) ?? []
    list.push({ id: b.id, code: b.code, format: b.format, isInternal: !!b.isInternal, isPrimary: !!b.isPrimary })
    byProduct.set(b.productId, list)
  }
  return rows.map((r) => ({
    ...(r as unknown as ProductRow),
    image: withImage ? ((r.image as string) ?? null) : null,
    trackExpiry: !!r.trackExpiry,
    active: !!r.active,
    archived: !!r.archived,
    barcodes: byProduct.get(r.id as number) ?? []
  }))
}

export interface ProductListOptions {
  search?: string
  categoryId?: number | null
  status?: 'active' | 'inactive' | 'archived' | 'all'
  stock?: 'all' | 'low' | 'out'
  limit?: number
  offset?: number
  withImages?: boolean
}

export function listProducts(db: DB, opts: ProductListOptions = {}) {
  const where: string[] = []
  const params: unknown[] = []
  const status = opts.status ?? 'active'
  if (status === 'active') where.push('p.archived = 0 AND p.active = 1')
  else if (status === 'inactive') where.push('p.archived = 0 AND p.active = 0')
  else if (status === 'archived') where.push('p.archived = 1')
  else where.push('p.archived = 0')
  if (opts.categoryId) {
    where.push('p.category_id = ?')
    params.push(opts.categoryId)
  }
  if (opts.stock === 'low') where.push('p.stock_milli > 0 AND p.stock_milli <= p.min_stock_milli')
  if (opts.stock === 'out') where.push('p.stock_milli <= 0')
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim()
    const t = likeTerm(q)
    where.push(
      `(p.name_fr LIKE ? ESCAPE '\\' OR p.name_ar LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.code LIKE ? ESCAPE '\\'))`
    )
    params.push(t, t, t, t)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM products p ${whereSql}`).get(...params) as { c: number }).c
  const limit = Math.min(opts.limit ?? 200, 5000)
  const rows = db
    .prepare(`${PRODUCT_SELECT} ${whereSql} ORDER BY p.name_fr COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...params, limit, opts.offset ?? 0) as Record<string, unknown>[]
  return { total, items: hydrate(db, rows, opts.withImages ?? true) }
}

export function getProduct(db: DB, id: number): ProductRow {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id) as Record<string, unknown> | undefined
  if (!row) throw new AppError('PRODUCT_NOT_FOUND')
  return hydrate(db, [row], true)[0]
}

/** Exact lookup by barcode or SKU (used by the scanner and POS). Only sellable products. */
export function lookupByCode(db: DB, rawCode: string): ProductRow | null {
  const code = normalizeBarcode(rawCode)
  if (!code) return null
  const byBarcode = db
    .prepare(`${PRODUCT_SELECT} JOIN product_barcodes b ON b.product_id = p.id WHERE b.code = ? AND p.archived = 0`)
    .get(code) as Record<string, unknown> | undefined
  if (byBarcode) return hydrate(db, [byBarcode], true)[0]
  const bySku = db.prepare(`${PRODUCT_SELECT} WHERE p.sku = ? COLLATE NOCASE AND p.archived = 0`).get(code) as
    | Record<string, unknown>
    | undefined
  return bySku ? hydrate(db, [bySku], true)[0] : null
}

/** Generates a new unique internal barcode (EAN-13 in the 20-29 restricted range, or Code128). */
export function generateInternalBarcode(db: DB, format: 'EAN13' | 'CODE128'): string {
  const labels = getSetting(db, 'labels')
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code =
      format === 'EAN13'
        ? buildInternalEan13(labels.internalEanPrefix, nextSequence(db, 'ean_internal'))
        : buildInternalCode128(labels.code128Prefix || 'SP', nextSequence(db, 'code128_internal'))
    const exists = db.prepare('SELECT 1 FROM product_barcodes WHERE code = ?').get(code)
    const skuExists = db.prepare('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE').get(code)
    if (!exists && !skuExists) return code
  }
  throw new AppError('BARCODE_GENERATION_FAILED')
}

function assertBarcodeFree(db: DB, code: string, productId: number | null): void {
  const row = db
    .prepare(
      `SELECT b.product_id AS productId, p.name_fr AS name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.code = ?`
    )
    .get(code) as { productId: number; name: string } | undefined
  if (row && row.productId !== productId) throw new AppError('BARCODE_EXISTS', { code, product: row.name })
  const sku = db.prepare('SELECT id, name_fr AS name FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?').get(code, productId ?? -1) as
    | { id: number; name: string }
    | undefined
  if (sku) throw new AppError('BARCODE_CONFLICTS_SKU', { code, product: sku.name })
}

function insertBarcode(db: DB, productId: number, code: string, isPrimary: boolean, isInternal: boolean) {
  const format = detectFormat(code)
  db.prepare(
    'INSERT INTO product_barcodes (product_id, code, format, is_internal, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(productId, code, format, isInternal ? 1 : 0, isPrimary ? 1 : 0, nowIso())
}

export function saveProduct(ctx: Ctx, id: number | null, raw: unknown): number {
  const input = productSchema.parse(raw)
  const db = ctx.db
  const canPrices = ctx.user.role === 'ADMIN' || ctx.user.permissions.includes('products.prices')
  const purchase = toCents(input.purchasePrice)
  const sale = toCents(input.salePrice)
  const minSale = input.minSalePrice === null || input.minSalePrice === undefined || input.minSalePrice === '' ? null : toCents(input.minSalePrice)
  if (purchase < 0 || sale < 0) throw new AppError('INVALID_PRICE')
  if (minSale !== null && minSale > sale) throw new AppError('MIN_PRICE_ABOVE_PRICE')
  const minStock = input.minStock === undefined || input.minStock === '' ? 0 : toMilli(input.minStock)
  const sku = input.sku ? input.sku : null
  const now = nowIso()

  return db.transaction(() => {
    if (sku) {
      const dup = db.prepare('SELECT id FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?').get(sku, id ?? -1)
      if (dup) throw new AppError('SKU_EXISTS', { sku })
      const bcDup = db.prepare('SELECT product_id FROM product_barcodes WHERE code = ? AND product_id <> ?').get(sku, id ?? -1)
      if (bcDup) throw new AppError('SKU_CONFLICTS_BARCODE', { sku })
    }
    const codes = [...new Set(input.barcodes.map((b) => normalizeBarcode(b.code)).filter(Boolean))]
    for (const c of codes) assertBarcodeFree(db, c, id)

    let productId: number
    if (id === null) {
      const r = db
        .prepare(
          `INSERT INTO products (name_fr, name_ar, sku, category_id, unit_code, product_type, purchase_price_cents, avg_cost_cents,
            sale_price_cents, min_sale_price_cents, stock_milli, min_stock_milli, track_expiry, expiry_date, image_path, notes,
            active, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          input.nameFr,
          input.nameAr || null,
          sku,
          input.categoryId ?? null,
          input.unitCode,
          input.productType,
          purchase,
          purchase,
          sale,
          minSale,
          minStock,
          input.trackExpiry ? 1 : 0,
          input.expiryDate || null,
          input.image || null,
          input.notes || null,
          input.active ? 1 : 0,
          now,
          now
        )
      productId = Number(r.lastInsertRowid)
      const initial = input.initialStock === undefined || input.initialStock === '' ? 0 : toMilli(input.initialStock)
      if (initial < 0) throw new AppError('INVALID_QUANTITY')
      if (initial > 0) {
        applyStockMovement(db, {
          productId,
          type: 'INITIAL_STOCK',
          qtyMilli: initial,
          unitCostCents: purchase,
          refType: 'product',
          refId: productId,
          userId: ctx.user.id
        })
      }
      audit(db, ctx.user.id, 'PRODUCT_CREATED', 'product', productId, { nameFr: input.nameFr, salePriceCents: sale })
    } else {
      const old = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
        | { sale_price_cents: number; purchase_price_cents: number; min_sale_price_cents: number | null; image_path: string | null }
        | undefined
      if (!old) throw new AppError('PRODUCT_NOT_FOUND')
      const priceChanged = old.sale_price_cents !== sale || old.purchase_price_cents !== purchase || old.min_sale_price_cents !== minSale
      if (priceChanged && !canPrices) throw new AppError('FORBIDDEN', { permission: 'products.prices' })
      const nextImage = input.image === undefined ? old.image_path : input.image || null
      db.prepare(
        `UPDATE products SET name_fr = ?, name_ar = ?, sku = ?, category_id = ?, unit_code = ?, product_type = ?,
          purchase_price_cents = ?, sale_price_cents = ?, min_sale_price_cents = ?, min_stock_milli = ?, track_expiry = ?,
          expiry_date = ?, image_path = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?`
      ).run(
        input.nameFr,
        input.nameAr || null,
        sku,
        input.categoryId ?? null,
        input.unitCode,
        input.productType,
        purchase,
        sale,
        minSale,
        minStock,
        input.trackExpiry ? 1 : 0,
        input.expiryDate || null,
        nextImage,
        input.notes || null,
        input.active ? 1 : 0,
        now,
        id
      )
      productId = id
      if (priceChanged) {
        audit(db, ctx.user.id, 'PRICE_CHANGED', 'product', id, {
          from: { sale: old.sale_price_cents, purchase: old.purchase_price_cents, min: old.min_sale_price_cents },
          to: { sale, purchase, min: minSale }
        })
      }
      audit(db, ctx.user.id, 'PRODUCT_UPDATED', 'product', id, { nameFr: input.nameFr })
    }

    // Sync barcodes: keep internal flags for codes that remain, remove those dropped.
    const existing = db.prepare('SELECT code, is_internal FROM product_barcodes WHERE product_id = ?').all(productId) as {
      code: string
      is_internal: number
    }[]
    const internalSet = new Set(existing.filter((e) => e.is_internal).map((e) => e.code))
    db.prepare('DELETE FROM product_barcodes WHERE product_id = ?').run(productId)
    const primaryCode = input.barcodes.find((b) => b.isPrimary)?.code ?? codes[0]
    codes.forEach((c) => insertBarcode(db, productId, c, c === primaryCode, internalSet.has(c)))
    if (input.generateBarcode) {
      const code = generateInternalBarcode(db, input.generateBarcode)
      insertBarcode(db, productId, code, codes.length === 0, true)
    }
    return productId
  })()
}

export function addBarcode(ctx: Ctx, productId: number, rawCode: string | null, generate: 'EAN13' | 'CODE128' | null) {
  const db = ctx.db
  return db.transaction(() => {
    const p = db.prepare('SELECT id FROM products WHERE id = ?').get(productId)
    if (!p) throw new AppError('PRODUCT_NOT_FOUND')
    const count = (db.prepare('SELECT COUNT(*) AS c FROM product_barcodes WHERE product_id = ?').get(productId) as { c: number }).c
    let code: string
    let internal = false
    if (generate) {
      code = generateInternalBarcode(db, generate)
      internal = true
    } else {
      code = normalizeBarcode(rawCode ?? '')
      if (!code) throw new AppError('BARCODE_REQUIRED')
      if (/^\d{13}$/.test(code) && !isValidEan13(code)) throw new AppError('INVALID_EAN13_CHECKSUM')
      assertBarcodeFree(db, code, productId)
    }
    insertBarcode(db, productId, code, count === 0, internal)
    audit(db, ctx.user.id, 'BARCODE_ADDED', 'product', productId, { code, internal })
    return code
  })()
}

export function removeBarcode(ctx: Ctx, barcodeId: number) {
  const db = ctx.db
  const row = db.prepare('SELECT product_id, code FROM product_barcodes WHERE id = ?').get(barcodeId) as
    | { product_id: number; code: string }
    | undefined
  if (!row) throw new AppError('NOT_FOUND')
  db.prepare('DELETE FROM product_barcodes WHERE id = ?').run(barcodeId)
  audit(db, ctx.user.id, 'BARCODE_REMOVED', 'product', row.product_id, { code: row.code })
}

/** Deletes a product if it has no history; otherwise archives it (history must be preserved). */
export function deleteProduct(ctx: Ctx, id: number): 'deleted' | 'archived' {
  const db = ctx.db
  return db.transaction(() => {
    const used = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) + (SELECT COUNT(*) FROM purchase_items WHERE product_id = ?)
          + (SELECT COUNT(*) FROM stock_movements WHERE product_id = ?) AS c`
      )
      .get(id, id, id) as { c: number }
    if (used.c > 0) {
      db.prepare('UPDATE products SET archived = 1, active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id)
      audit(db, ctx.user.id, 'PRODUCT_ARCHIVED', 'product', id)
      return 'archived'
    }
    db.prepare('DELETE FROM inventory_count_items WHERE product_id = ?').run(id)
    db.prepare('DELETE FROM products WHERE id = ?').run(id)
    audit(db, ctx.user.id, 'PRODUCT_DELETED', 'product', id)
    return 'deleted'
  })()
}

export function restoreProduct(ctx: Ctx, id: number) {
  ctx.db.prepare('UPDATE products SET archived = 0, active = 1, updated_at = ? WHERE id = ?').run(nowIso(), id)
  audit(ctx.db, ctx.user.id, 'PRODUCT_RESTORED', 'product', id)
}

// ======================= CSV import/export =======================

export const CSV_COLUMNS = [
  'sku',
  'name_fr',
  'name_ar',
  'category',
  'unit',
  'type',
  'purchase_price',
  'sale_price',
  'min_sale_price',
  'stock',
  'min_stock',
  'barcodes',
  'track_expiry',
  'expiry_date',
  'active'
] as const

export function exportProductsCsv(db: DB): string {
  const { items } = listProducts(db, { status: 'all', limit: 5000 })
  const rows = items.map((p) => ({
    sku: p.sku ?? '',
    name_fr: p.nameFr,
    name_ar: p.nameAr ?? '',
    category: p.categoryName ?? '',
    unit: p.unitCode,
    type: p.productType,
    purchase_price: fromCents(p.purchasePriceCents).toFixed(2),
    sale_price: fromCents(p.salePriceCents).toFixed(2),
    min_sale_price: p.minSalePriceCents === null ? '' : fromCents(p.minSalePriceCents).toFixed(2),
    stock: String(fromMilli(p.stockMilli)),
    min_stock: String(fromMilli(p.minStockMilli)),
    barcodes: p.barcodes.map((b) => b.code).join('|'),
    track_expiry: p.trackExpiry ? '1' : '0',
    expiry_date: p.expiryDate ?? '',
    active: p.active ? '1' : '0'
  }))
  // BOM so Excel opens UTF-8 (Arabic) correctly.
  return '\uFEFF' + Papa.unparse({ fields: [...CSV_COLUMNS], data: rows.map((r) => CSV_COLUMNS.map((c) => r[c])) })
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: { line: number; message: string }[]
}

/**
 * Imports products from CSV. Match order: SKU, then any barcode. New products get their
 * `stock` as an INITIAL_STOCK movement. For existing products the stock column is ignored
 * (stock changes must go through traceable movements) and reported in the result.
 */
export function importProductsCsv(ctx: Ctx, csvText: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase()
  })
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const db = ctx.db
  const catCache = new Map<string, number>()
  const getCategory = (name: string): number | null => {
    const n = name.trim()
    if (!n) return null
    const key = n.toLowerCase()
    if (catCache.has(key)) return catCache.get(key)!
    const row = db.prepare('SELECT id FROM categories WHERE name_fr = ? COLLATE NOCASE').get(n) as { id: number } | undefined
    const id = row ? row.id : saveCategory(ctx, null, { nameFr: n, active: true })
    catCache.set(key, id)
    return id
  }
  parsed.data.forEach((r, idx) => {
    const line = idx + 2
    try {
      const unit = (r.unit || 'pc').trim()
      if (!isUnitCode(unit)) throw new AppError('INVALID_UNIT', { unit })
      const barcodes = (r.barcodes || '')
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const sku = (r.sku || '').trim() || null
      let existingId: number | null = null
      if (sku) existingId = (db.prepare('SELECT id FROM products WHERE sku = ? COLLATE NOCASE').get(sku) as { id: number } | undefined)?.id ?? null
      if (!existingId)
        for (const b of barcodes) {
          const row = db.prepare('SELECT product_id FROM product_barcodes WHERE code = ?').get(b) as { product_id: number } | undefined
          if (row) {
            existingId = row.product_id
            break
          }
        }
      const type = productTypeEnum.safeParse((r.type || '').trim()).success
        ? (r.type.trim() as z.infer<typeof productTypeEnum>)
        : unit === 'kg' || unit === 'g'
          ? 'weight'
          : unit === 'L' || unit === 'ml'
            ? 'volume'
            : 'standard'
      const input: ProductInput = {
        nameFr: (r.name_fr || '').trim(),
        nameAr: (r.name_ar || '').trim() || null,
        sku,
        categoryId: getCategory(r.category || ''),
        unitCode: unit,
        productType: type,
        purchasePrice: r.purchase_price || '0',
        salePrice: r.sale_price || '0',
        minSalePrice: r.min_sale_price || null,
        minStock: r.min_stock || '0',
        initialStock: existingId ? undefined : r.stock || '0',
        trackExpiry: r.track_expiry === '1' || r.track_expiry?.toLowerCase() === 'true',
        expiryDate: (r.expiry_date || '').trim() || null,
        active: r.active === undefined || r.active === '' ? true : r.active === '1' || r.active.toLowerCase() === 'true',
        barcodes: barcodes.map((code) => ({ code }))
      }
      if (existingId) {
        const existing = getProduct(db, existingId)
        input.image = existing.image
        const merged = [...new Set([...existing.barcodes.map((b) => b.code), ...barcodes])]
        input.barcodes = merged.map((code) => ({ code }))
        saveProduct(ctx, existingId, input)
        result.updated++
      } else {
        saveProduct(ctx, null, input)
        result.created++
      }
    } catch (e) {
      result.skipped++
      const msg = e instanceof AppError ? `${e.code} ${JSON.stringify(e.params)}` : e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(e)
      result.errors.push({ line, message: msg })
    }
  })
  audit(db, ctx.user.id, 'PRODUCTS_IMPORTED', 'product', null, { created: result.created, updated: result.updated, skipped: result.skipped })
  return result
}

