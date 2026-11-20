import Papa from 'papaparse'
import type { DB } from '../db/connection'
import { dayRange, getDataRevision, getSetting, localDateString } from './common'
import { listCustomers } from './partners'
import { fromCents, fromMilli, lineAmount } from '@shared/money'

export interface StockAlertsSummary {
  lowStockCount: number
  outOfStockCount: number
  expiringCount: number
}

const alertsCache = new WeakMap<DB, { key: string; data: StockAlertsSummary }>()
const dashboardCache = new WeakMap<DB, { key: string; data: DashboardData }>()

export function getAlertCounts(db: DB): StockAlertsSummary {
  const todayStr = localDateString()
  const key = `${getDataRevision(db)}:${todayStr}`
  const cached = alertsCache.get(db)
  if (cached && cached.key === key) return cached.data

  const prodStats = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN stock_milli > 0 AND stock_milli <= min_stock_milli THEN 1 ELSE 0 END), 0) AS low,
        COALESCE(SUM(CASE WHEN stock_milli <= 0 THEN 1 ELSE 0 END), 0) AS outCount
       FROM products WHERE archived = 0 AND active = 1`
    )
    .get() as { low: number; outCount: number }

  const expiryDays = getSetting(db, 'stock').expiryAlertDays
  const expiryLimit = new Date(Date.now() + expiryDays * 86400000).toISOString().slice(0, 10)
  const expiringCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM products WHERE archived = 0 AND active = 1 AND track_expiry = 1 AND expiry_date IS NOT NULL AND expiry_date <= ?'
      )
      .get(expiryLimit) as { c: number }
  ).c

  const data: StockAlertsSummary = {
    lowStockCount: prodStats.low,
    outOfStockCount: prodStats.outCount,
    expiringCount
  }
  alertsCache.set(db, { key, data })
  return data
}

export interface DashboardData {
  todayRevenueCents: number
  todaySalesCount: number
  todayCogsCents: number
  todayGrossProfitCents: number
  todayExpensesCents: number
  todayNetProfitCents: number
  totalProducts: number
  lowStockCount: number
  outOfStockCount: number
  expiringCount: number
  totalCustomerDebtCents: number
  debtorCount: number
  recentSales: {
    id: number
    invoiceNo: string
    createdAt: string
    customerName: string | null
    userName: string
    totalCents: number
    paidCents: number
    creditCents: number
  }[]
  bestSellers: {
    productId: number
    nameFr: string
    nameAr: string | null
    unitCode: string
    qtyMilli: number
    revenueCents: number
    profitCents: number
  }[]
  lowStockItems: {
    id: number
    nameFr: string
    nameAr: string | null
    unitCode: string
    stockMilli: number
    minStockMilli: number
  }[]
  chartDaily: { label: string; revenueCents: number; profitCents: number; count: number }[]
  chartWeekly: { label: string; revenueCents: number; profitCents: number; count: number }[]
  chartMonthly: { label: string; revenueCents: number; profitCents: number; count: number }[]
}

export function getDashboardData(db: DB): DashboardData {
  const todayStr = localDateString()
  const cacheKey = `${getDataRevision(db)}:${todayStr}`
  const cached = dashboardCache.get(db)
  if (cached && cached.key === cacheKey) return cached.data

  const { from: todayFrom, to: todayTo } = dayRange(todayStr, todayStr)

  const salesToday = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS grossRev, COALESCE(SUM(cost_cents), 0) AS grossCost
       FROM sales WHERE created_at >= ? AND created_at < ?`
    )
    .get(todayFrom, todayTo) as { count: number; grossRev: number; grossCost: number }

  const returnsToday = db
    .prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS retRev, COALESCE(SUM(cost_cents), 0) AS retCost
       FROM sale_returns WHERE created_at >= ? AND created_at < ?`
    )
    .get(todayFrom, todayTo) as { retRev: number; retCost: number }

  const todayRevenueCents = salesToday.grossRev - returnsToday.retRev
  const todayCogsCents = salesToday.grossCost - returnsToday.retCost
  const todayGrossProfitCents = todayRevenueCents - todayCogsCents

  const todayExpensesCents = (
    db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses WHERE deleted = 0 AND expense_date = ?')
      .get(todayStr) as { v: number }
  ).v
  const todayNetProfitCents = todayGrossProfitCents - todayExpensesCents

  const prodStats = db
    .prepare(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN stock_milli > 0 AND stock_milli <= min_stock_milli THEN 1 ELSE 0 END), 0) AS low,
        COALESCE(SUM(CASE WHEN stock_milli <= 0 THEN 1 ELSE 0 END), 0) AS outCount
       FROM products WHERE archived = 0 AND active = 1`
    )
    .get() as { total: number; low: number; outCount: number }

  const expiryDays = getSetting(db, 'stock').expiryAlertDays
  const expiryLimit = new Date(Date.now() + expiryDays * 86400000).toISOString().slice(0, 10)
  const expiringCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM products WHERE archived = 0 AND active = 1 AND track_expiry = 1 AND expiry_date IS NOT NULL AND expiry_date <= ?'
      )
      .get(expiryLimit) as { c: number }
  ).c

  // Single-pass grouped customer debt aggregation (avoids 3x correlated subqueries per customer)
  const debtAgg = db
    .prepare(
      `WITH
        sc AS (SELECT customer_id, SUM(credit_cents) AS v FROM sales WHERE customer_id IS NOT NULL AND credit_cents > 0 GROUP BY customer_id),
        sr AS (SELECT s.customer_id, SUM(r.debt_reduction_cents) AS v FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE s.customer_id IS NOT NULL AND r.debt_reduction_cents > 0 GROUP BY s.customer_id),
        cp AS (SELECT customer_id, SUM(amount_cents) AS v FROM customer_payments GROUP BY customer_id),
        bal AS (
          SELECT (COALESCE(sc.v, 0) - COALESCE(sr.v, 0) - COALESCE(cp.v, 0)) AS b
          FROM customers c
          LEFT JOIN sc ON sc.customer_id = c.id
          LEFT JOIN sr ON sr.customer_id = c.id
          LEFT JOIN cp ON cp.customer_id = c.id
          WHERE c.active = 1
        )
       SELECT COUNT(*) AS cnt, COALESCE(SUM(b), 0) AS total FROM bal WHERE b > 0`
    )
    .get() as { cnt: number; total: number }

  const recentSales = db
    .prepare(
      `SELECT s.id, s.invoice_no AS invoiceNo, s.created_at AS createdAt, c.name AS customerName, u.full_name AS userName,
        s.total_cents AS totalCents, s.paid_cents AS paidCents, s.credit_cents AS creditCents
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
       ORDER BY s.id DESC LIMIT 8`
    )
    .all() as DashboardData['recentSales']

  // Best-selling products (last 30 days, net of returns) using indexed LEFT JOIN instead of 3x correlated subqueries
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  const bestSellers = db
    .prepare(
      `WITH ret_by_item AS (
         SELECT sri.sale_item_id, SUM(sri.amount_cents) AS ret_amt, SUM(sri.cost_cents) AS ret_cost
         FROM sale_return_items sri
         JOIN sale_items si2 ON si2.id = sri.sale_item_id
         JOIN sales s2 ON s2.id = si2.sale_id
         WHERE s2.created_at >= ?
         GROUP BY sri.sale_item_id
       )
       SELECT p.id AS productId, p.name_fr AS nameFr, p.name_ar AS nameAr, p.unit_code AS unitCode,
         SUM(si.qty_milli - si.returned_milli) AS qtyMilli,
         SUM(si.total_cents - COALESCE(r.ret_amt, 0)) AS revenueCents,
         SUM((si.total_cents - COALESCE(r.ret_amt, 0)) - (si.cost_cents - COALESCE(r.ret_cost, 0))) AS profitCents
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN ret_by_item r ON r.sale_item_id = si.id
       WHERE s.created_at >= ?
       GROUP BY p.id
       HAVING qtyMilli > 0
       ORDER BY revenueCents DESC
       LIMIT 8`
    )
    .all(thirtyAgo, thirtyAgo) as DashboardData['bestSellers']

  const lowStockItems = db
    .prepare(
      `SELECT id, name_fr AS nameFr, name_ar AS nameAr, unit_code AS unitCode, stock_milli AS stockMilli, min_stock_milli AS minStockMilli
       FROM products WHERE archived = 0 AND active = 1 AND stock_milli <= min_stock_milli
       ORDER BY stock_milli ASC LIMIT 8`
    )
    .all() as DashboardData['lowStockItems']

  // Charts: fetch daily aggregates ONCE for the last 12 months (2 covering-index queries instead of 76 loop queries!)
  const now = new Date()
  const twelveMonthsStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const chartFromIso = twelveMonthsStart.toISOString()

  const dailySalesRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS d, COUNT(*) AS c, COALESCE(SUM(total_cents), 0) AS r, COALESCE(SUM(cost_cents), 0) AS cost
       FROM sales WHERE created_at >= ? GROUP BY d`
    )
    .all(chartFromIso) as { d: string; c: number; r: number; cost: number }[]

  const dailyRetRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS d, COALESCE(SUM(total_cents), 0) AS r, COALESCE(SUM(cost_cents), 0) AS cost
       FROM sale_returns WHERE created_at >= ? GROUP BY d`
    )
    .all(chartFromIso) as { d: string; r: number; cost: number }[]

  const dayMap = new Map<string, { c: number; r: number; cost: number }>()
  for (const row of dailySalesRows) {
    dayMap.set(row.d, { c: row.c, r: row.r, cost: row.cost })
  }
  for (const row of dailyRetRows) {
    const cur = dayMap.get(row.d) ?? { c: 0, r: 0, cost: 0 }
    cur.r -= row.r
    cur.cost -= row.cost
    dayMap.set(row.d, cur)
  }

  const chartDaily: DashboardData['chartDaily'] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const ds = localDateString(d)
    const bucket = dayMap.get(ds) ?? { c: 0, r: 0, cost: 0 }
    chartDaily.push({ label: ds.slice(5), revenueCents: bucket.r, profitCents: bucket.r - bucket.cost, count: bucket.c })
  }

  const chartWeekly: DashboardData['chartWeekly'] = []
  for (let w = 11; w >= 0; w--) {
    const end = new Date(now)
    end.setDate(end.getDate() - w * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    const startStr = localDateString(start)
    let rev = 0
    let cost = 0
    let count = 0
    for (let dOff = 0; dOff < 7; dOff++) {
      const cur = new Date(start)
      cur.setDate(cur.getDate() + dOff)
      const b = dayMap.get(localDateString(cur))
      if (b) {
        rev += b.r
        cost += b.cost
        count += b.c
      }
    }
    chartWeekly.push({ label: startStr.slice(5), revenueCents: rev, profitCents: rev - cost, count })
  }

  const monthMap = new Map<string, { c: number; r: number; cost: number }>()
  for (const [ds, b] of dayMap) {
    const mKey = ds.slice(0, 7)
    const cur = monthMap.get(mKey) ?? { c: 0, r: 0, cost: 0 }
    cur.c += b.c
    cur.r += b.r
    cur.cost += b.cost
    monthMap.set(mKey, cur)
  }

  const chartMonthly: DashboardData['chartMonthly'] = []
  for (let m = 11; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const b = monthMap.get(label) ?? { c: 0, r: 0, cost: 0 }
    chartMonthly.push({ label, revenueCents: b.r, profitCents: b.r - b.cost, count: b.c })
  }

  const result: DashboardData = {
    todayRevenueCents,
    todaySalesCount: salesToday.count,
    todayCogsCents,
    todayGrossProfitCents,
    todayExpensesCents,
    todayNetProfitCents,
    totalProducts: prodStats.total,
    lowStockCount: prodStats.low,
    outOfStockCount: prodStats.outCount,
    expiringCount,
    totalCustomerDebtCents: debtAgg.total,
    debtorCount: debtAgg.cnt,
    recentSales,
    bestSellers,
    lowStockItems,
    chartDaily,
    chartWeekly,
    chartMonthly
  }
  dashboardCache.set(db, { key: cacheKey, data: result })
  return result
}

export interface ReportFilter {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  userId?: number | null
}

export function getComprehensiveReport(db: DB, filter: ReportFilter) {
  const { from, to } = dayRange(filter.from, filter.to)
  const userCond = filter.userId ? 'AND s.user_id = ?' : ''
  const userParams = filter.userId ? [from, to, filter.userId] : [from, to]

  const salesSummary = db
    .prepare(
      `SELECT COUNT(*) AS salesCount,
        COALESCE(SUM(s.subtotal_cents), 0) AS subtotalCents,
        COALESCE(SUM(s.lines_discount_cents + s.cart_discount_cents), 0) AS discountCents,
        COALESCE(SUM(s.total_cents), 0) AS grossRevenueCents,
        COALESCE(SUM(s.paid_cents), 0) AS paidCents,
        COALESCE(SUM(s.credit_cents), 0) AS creditCents,
        COALESCE(SUM(s.cost_cents), 0) AS grossCostCents
       FROM sales s WHERE s.created_at >= ? AND s.created_at < ? ${userCond}`
    )
    .get(...userParams) as {
    salesCount: number
    subtotalCents: number
    discountCents: number
    grossRevenueCents: number
    paidCents: number
    creditCents: number
    grossCostCents: number
  }

  const returnCond = filter.userId ? 'AND s.user_id = ?' : ''
  const returnsSummary = db
    .prepare(
      `SELECT COUNT(*) AS returnsCount,
        COALESCE(SUM(r.total_cents), 0) AS returnedRevenueCents,
        COALESCE(SUM(r.cost_cents), 0) AS returnedCostCents
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id
       WHERE r.created_at >= ? AND r.created_at < ? ${returnCond}`
    )
    .get(...userParams) as { returnsCount: number; returnedRevenueCents: number; returnedCostCents: number }

  const netRevenueCents = salesSummary.grossRevenueCents - returnsSummary.returnedRevenueCents
  const netCogsCents = salesSummary.grossCostCents - returnsSummary.returnedCostCents
  const grossProfitCents = netRevenueCents - netCogsCents

  const expSummary = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS totalCents, COUNT(*) AS count
       FROM expenses WHERE expense_date >= ? AND expense_date <= ? AND deleted = 0`
    )
    .get(filter.from, filter.to) as { totalCents: number; count: number }

  const netProfitCents = grossProfitCents - expSummary.totalCents

  // Sales by Product (using historical unit_cost_cents/cost_cents stored on sale_items + indexed return CTE)
  const byProduct = db
    .prepare(
      `WITH ret_by_item AS (
         SELECT sri.sale_item_id, SUM(sri.amount_cents) AS ret_amt, SUM(sri.cost_cents) AS ret_cost
         FROM sale_return_items sri
         JOIN sale_items si2 ON si2.id = sri.sale_item_id
         JOIN sales s2 ON s2.id = si2.sale_id
         WHERE s2.created_at >= ? AND s2.created_at < ? ${filter.userId ? 'AND s2.user_id = ?' : ''}
         GROUP BY sri.sale_item_id
       )
       SELECT p.id AS productId, p.sku, p.name_fr AS nameFr, p.name_ar AS nameAr, p.unit_code AS unitCode,
         c.name_fr AS categoryName,
         SUM(si.qty_milli - si.returned_milli) AS qtyMilli,
         SUM(si.total_cents - COALESCE(r.ret_amt, 0)) AS revenueCents,
         SUM(si.cost_cents - COALESCE(r.ret_cost, 0)) AS costCents
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN ret_by_item r ON r.sale_item_id = si.id
       WHERE s.created_at >= ? AND s.created_at < ? ${userCond}
       GROUP BY p.id
       ORDER BY revenueCents DESC`
    )
    .all(...userParams, ...userParams)
    .map((r) => {
      const row = r as {
        productId: number
        sku: string | null
        nameFr: string
        nameAr: string | null
        unitCode: string
        categoryName: string | null
        qtyMilli: number
        revenueCents: number
        costCents: number
      }
      return { ...row, grossProfitCents: row.revenueCents - row.costCents }
    })

  // Sales by Category (using indexed return CTE)
  const byCategory = db
    .prepare(
      `WITH ret_by_item AS (
         SELECT sri.sale_item_id, SUM(sri.amount_cents) AS ret_amt, SUM(sri.cost_cents) AS ret_cost
         FROM sale_return_items sri
         JOIN sale_items si2 ON si2.id = sri.sale_item_id
         JOIN sales s2 ON s2.id = si2.sale_id
         WHERE s2.created_at >= ? AND s2.created_at < ? ${filter.userId ? 'AND s2.user_id = ?' : ''}
         GROUP BY sri.sale_item_id
       )
       SELECT COALESCE(c.id, 0) AS categoryId, COALESCE(c.name_fr, 'Sans catégorie') AS nameFr, COALESCE(c.name_ar, 'بدون فئة') AS nameAr,
         COUNT(DISTINCT s.id) AS salesCount,
         SUM(si.total_cents - COALESCE(r.ret_amt, 0)) AS revenueCents,
         SUM(si.cost_cents - COALESCE(r.ret_cost, 0)) AS costCents
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN ret_by_item r ON r.sale_item_id = si.id
       WHERE s.created_at >= ? AND s.created_at < ? ${userCond}
       GROUP BY COALESCE(c.id, 0)
       ORDER BY revenueCents DESC`
    )
    .all(...userParams, ...userParams)
    .map((r) => {
      const row = r as { categoryId: number; nameFr: string; nameAr: string; salesCount: number; revenueCents: number; costCents: number }
      return { ...row, grossProfitCents: row.revenueCents - row.costCents }
    })

  // Cashier performance
  const byCashier = db
    .prepare(
      `SELECT u.id AS userId, u.username, u.full_name AS fullName,
        COUNT(s.id) AS salesCount,
        COALESCE(SUM(s.total_cents), 0) AS revenueCents,
        COALESCE(SUM(s.lines_discount_cents + s.cart_discount_cents), 0) AS discountCents,
        COALESCE(SUM(s.credit_cents), 0) AS creditCents,
        COALESCE(SUM(s.total_cents - s.cost_cents), 0) AS grossProfitCents
       FROM users u
       LEFT JOIN sales s ON s.user_id = u.id AND s.created_at >= ? AND s.created_at < ?
       GROUP BY u.id
       ORDER BY revenueCents DESC`
    )
    .all(from, to) as {
    userId: number
    username: string
    fullName: string
    salesCount: number
    revenueCents: number
    discountCents: number
    creditCents: number
    grossProfitCents: number
  }[]

  // Payment methods breakdown (driven by sales date index, not full scan of sale_payments)
  const byPaymentMethod = db
    .prepare(
      `SELECT pm.code, pm.name_fr AS nameFr, pm.name_ar AS nameAr, COALESCE(SUM(sp.amount_cents), 0) AS amountCents, COUNT(sp.id) AS count
       FROM sales s
       JOIN sale_payments sp ON sp.sale_id = s.id
       JOIN payment_methods pm ON pm.code = sp.method_code
       WHERE s.created_at >= ? AND s.created_at < ? ${userCond}
       GROUP BY pm.code
       ORDER BY amountCents DESC`
    )
    .all(...userParams) as { code: string; nameFr: string; nameAr: string; amountCents: number; count: number }[]

  // Purchases summary in period
  const purchasesSummary = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents - returned_cents), 0) AS netTotalCents,
        COALESCE((SELECT SUM(pp.amount_cents) FROM purchase_payments pp JOIN purchases p2 ON p2.id = pp.purchase_id WHERE p2.order_date >= ? AND p2.order_date <= ? AND p2.status = 'received'), 0) AS paidCents
       FROM purchases WHERE order_date >= ? AND order_date <= ? AND status = 'received'`
    )
    .get(filter.from, filter.to, filter.from, filter.to) as { count: number; netTotalCents: number; paidCents: number }

  // Stock valuation
  const stockProds = db
    .prepare(
      `SELECT id, sku, name_fr AS nameFr, name_ar AS nameAr, unit_code AS unitCode, stock_milli AS stockMilli,
        min_stock_milli AS minStockMilli, avg_cost_cents AS avgCostCents, sale_price_cents AS salePriceCents
       FROM products WHERE archived = 0 AND active = 1 ORDER BY name_fr COLLATE NOCASE`
    )
    .all() as {
    id: number
    sku: string | null
    nameFr: string
    nameAr: string | null
    unitCode: string
    stockMilli: number
    minStockMilli: number
    avgCostCents: number
    salePriceCents: number
  }[]
  let totalStockCostCents = 0
  let totalStockRetailCents = 0
  const stockValuation = stockProds.map((p) => {
    const costValueCents = p.stockMilli > 0 ? lineAmount(p.stockMilli, p.avgCostCents) : 0
    const retailValueCents = p.stockMilli > 0 ? lineAmount(p.stockMilli, p.salePriceCents) : 0
    totalStockCostCents += costValueCents
    totalStockRetailCents += retailValueCents
    return { ...p, costValueCents, retailValueCents }
  })

  const lowStock = stockValuation.filter((p) => p.stockMilli <= p.minStockMilli)
  const customerDebts = listCustomers(db, { withDebtOnly: true })

  return {
    filter,
    summary: {
      salesCount: salesSummary.salesCount,
      returnsCount: returnsSummary.returnsCount,
      subtotalCents: salesSummary.subtotalCents,
      discountCents: salesSummary.discountCents,
      grossRevenueCents: salesSummary.grossRevenueCents,
      returnedRevenueCents: returnsSummary.returnedRevenueCents,
      netRevenueCents,
      paidCents: salesSummary.paidCents,
      creditCents: salesSummary.creditCents,
      netCogsCents,
      grossProfitCents,
      expensesCents: expSummary.totalCents,
      expensesCount: expSummary.count,
      netProfitCents,
      purchasesCount: purchasesSummary.count,
      purchasesTotalCents: purchasesSummary.netTotalCents,
      purchasesPaidCents: purchasesSummary.paidCents,
      totalStockCostCents,
      totalStockRetailCents,
      totalCustomerDebtCents: customerDebts.reduce((a, c) => a + c.balanceCents, 0)
    },
    byProduct,
    byCategory,
    byCashier,
    byPaymentMethod,
    stockValuation,
    lowStock,
    customerDebts
  }
}

export function exportReportCsv(
  db: DB,
  filter: ReportFilter,
  section: 'products' | 'categories' | 'cashiers' | 'stock' | 'low_stock' | 'debts'
): string {
  const rep = getComprehensiveReport(db, filter)
  let rows: Record<string, string | number>[] = []
  if (section === 'products') {
    rows = rep.byProduct.map((p) => ({
      SKU: p.sku ?? '',
      Produit_FR: p.nameFr,
      Produit_AR: p.nameAr ?? '',
      Categorie: p.categoryName ?? '',
      Unite: p.unitCode,
      Quantite: fromMilli(p.qtyMilli),
      CA_DH: fromCents(p.revenueCents).toFixed(2),
      Cout_Achat_Historique_DH: fromCents(p.costCents).toFixed(2),
      Marge_Brute_DH: fromCents(p.grossProfitCents).toFixed(2)
    }))
  } else if (section === 'categories') {
    rows = rep.byCategory.map((c) => ({
      Categorie_FR: c.nameFr,
      Categorie_AR: c.nameAr,
      Ventes: c.salesCount,
      CA_DH: fromCents(c.revenueCents).toFixed(2),
      Cout_DH: fromCents(c.costCents).toFixed(2),
      Marge_Brute_DH: fromCents(c.grossProfitCents).toFixed(2)
    }))
  } else if (section === 'cashiers') {
    rows = rep.byCashier.map((u) => ({
      Caissier: u.fullName,
      Identifiant: u.username,
      Nb_Ventes: u.salesCount,
      CA_DH: fromCents(u.revenueCents).toFixed(2),
      Remises_DH: fromCents(u.discountCents).toFixed(2),
      Credits_DH: fromCents(u.creditCents).toFixed(2),
      Marge_Brute_DH: fromCents(u.grossProfitCents).toFixed(2)
    }))
  } else if (section === 'stock' || section === 'low_stock') {
    const list = section === 'low_stock' ? rep.lowStock : rep.stockValuation
    rows = list.map((p) => ({
      SKU: p.sku ?? '',
      Produit_FR: p.nameFr,
      Produit_AR: p.nameAr ?? '',
      Unite: p.unitCode,
      Stock: fromMilli(p.stockMilli),
      Stock_Min: fromMilli(p.minStockMilli),
      CMUP_DH: fromCents(p.avgCostCents).toFixed(2),
      Prix_Vente_DH: fromCents(p.salePriceCents).toFixed(2),
      Valeur_Cout_DH: fromCents(p.costValueCents).toFixed(2),
      Valeur_Vente_DH: fromCents(p.retailValueCents).toFixed(2)
    }))
  } else if (section === 'debts') {
    rows = rep.customerDebts.map((c) => ({
      Client: c.name,
      Telephone: c.phone ?? '',
      Adresse: c.address ?? '',
      Dette_DH: fromCents(c.balanceCents).toFixed(2),
      Plafond_DH: c.creditLimitCents === null ? '' : fromCents(c.creditLimitCents).toFixed(2),
      Derniere_Vente: c.lastSaleAt ?? ''
    }))
  }
  return '\uFEFF' + Papa.unparse(rows)
}

