import type { SessionUser } from '../main/services/common'
import type { ProductRow, ProductListOptions, ImportResult } from '../main/services/products'
import type { CustomerRow, StatementEntry } from '../main/services/partners'
import type { CashSessionSummary } from '../main/services/cash'
import type { SaleDetail } from '../main/services/sales'
import type { DashboardData, ReportFilter } from '../main/services/reports'
import type { BackupRecord, RemovableDrive } from '../main/services/backup'
import type { ScaleReading, ScaleStatus } from '../main/services/scale'
import type { LabelSpec } from '../main/services/printing'
import type { AppSettings } from './settings'
import type { MovementType } from '../main/services/stock'

export interface IpcResult<T> {
  ok: true
  data: T
}

export interface IpcError {
  ok: false
  code: string
  params?: Record<string, string | number>
  message: string
}

export type IpcResponse<T> = IpcResult<T> | IpcError

export interface SmartPosApi {
  // Auth & session
  getSession(): Promise<SessionUser | null>
  login(username: string, password: string): Promise<SessionUser>
  logout(): Promise<void>
  changeOwnPassword(current: string, next: string): Promise<void>
  setLanguage(lang: 'fr' | 'ar'): Promise<void>

  // Dashboard
  getDashboard(): Promise<DashboardData>

  // Categories
  listCategories(): Promise<{ id: number; nameFr: string; nameAr: string | null; color: string | null; active: boolean; productCount: number }[]>
  saveCategory(id: number | null, data: unknown): Promise<number>
  deleteCategory(id: number): Promise<void>

  // Products & Barcodes
  listProducts(opts?: ProductListOptions): Promise<{ total: number; items: ProductRow[] }>
  getProduct(id: number): Promise<ProductRow>
  lookupByCode(code: string): Promise<ProductRow | null>
  saveProduct(id: number | null, data: unknown): Promise<number>
  deleteProduct(id: number): Promise<'deleted' | 'archived'>
  restoreProduct(id: number): Promise<void>
  addBarcode(productId: number, code: string | null, generate: 'EAN13' | 'CODE128' | null): Promise<string>
  removeBarcode(barcodeId: number): Promise<void>
  generateInternalBarcode(format: 'EAN13' | 'CODE128'): Promise<string>
  renderBarcodePng(code: string, format?: 'EAN13' | 'CODE128' | 'AUTO'): Promise<string>
  exportProductsCsv(): Promise<{ saved: boolean; filePath?: string }>
  importProductsCsv(): Promise<ImportResult | null>

  // Stock & Inventory
  stockOverview(opts?: { filter?: 'all' | 'low' | 'out' | 'expiring'; search?: string; categoryId?: number }): Promise<
    {
      id: number
      nameFr: string
      nameAr: string | null
      sku: string | null
      unitCode: string
      stockMilli: number
      minStockMilli: number
      avgCostCents: number
      salePriceCents: number
      expiryDate: string | null
      trackExpiry: boolean
      categoryName: string | null
      categoryNameAr: string | null
      valueCents: number
    }[]
  >
  manualMovement(data: unknown): Promise<{ balanceAfter: number; movementId: number }>
  listMovements(opts?: { productId?: number; type?: string; from?: string; to?: string; limit?: number; search?: string }): Promise<
    {
      id: number
      productId: number
      productName: string
      productNameAr: string | null
      unitCode: string
      type: MovementType
      qtyMilli: number
      balanceAfterMilli: number
      unitCostCents: number
      refType: string | null
      refId: number | null
      note: string | null
      createdAt: string
      userName: string | null
    }[]
  >
  listInventoryCounts(): Promise<
    {
      id: number
      status: 'open' | 'finalized' | 'cancelled'
      createdAt: string
      finalizedAt: string | null
      notes: string | null
      userName: string
      itemCount: number
      countedCount: number
    }[]
  >
  createInventoryCount(opts: { categoryId?: number | null; notes?: string | null }): Promise<number>
  getInventoryCount(id: number): Promise<{
    id: number
    status: string
    createdAt: string
    finalizedAt: string | null
    notes: string | null
    items: {
      id: number
      productId: number
      nameFr: string
      nameAr: string | null
      sku: string | null
      unitCode: string
      expectedMilli: number
      countedMilli: number | null
      unitCostCents: number
      barcodes: string | null
      differenceMilli: number | null
      differenceValueCents: number | null
    }[]
  }>
  setCountedQty(itemId: number, qty: string | number | null): Promise<void>
  finalizeInventoryCount(id: number): Promise<{ adjusted: number }>
  cancelInventoryCount(id: number): Promise<void>

  // Cash Register Sessions & Payment Methods
  currentCashSession(): Promise<CashSessionSummary | null>
  openCashSession(opening: string | number, notes?: string | null): Promise<CashSessionSummary>
  closeCashSession(sessionId: number, counted: string | number, notes?: string | null): Promise<CashSessionSummary>
  listCashSessions(opts?: { userId?: number; status?: 'open' | 'closed'; limit?: number }): Promise<CashSessionSummary[]>
  listPaymentMethods(includeInactive?: boolean): Promise<
    { code: string; nameFr: string; nameAr: string; isCash: boolean; active: boolean; builtin: boolean; sort: number }[]
  >
  savePaymentMethod(input: { code: string; nameFr: string; nameAr: string; active: boolean; sort?: number }): Promise<void>

  // Sales, Returns & Customer Credits
  createSale(data: unknown): Promise<SaleDetail>
  getSale(id: number): Promise<SaleDetail>
  listSales(opts?: { from?: string; to?: string; userId?: number; customerId?: number; search?: string; limit?: number; onlyCredit?: boolean }): Promise<
    {
      id: number
      invoiceNo: string
      createdAt: string
      userName: string
      customerName: string | null
      totalCents: number
      paidCents: number
      creditCents: number
      returnedCents: number
      costCents: number
      status: string
      itemCount: number
      methods: string | null
    }[]
  >
  createSaleReturn(data: unknown): Promise<{ returnId: number; returnNo: string; totalCents: number; cashRefundCents: number; debtReductionCents: number }>
  listReturns(opts?: { from?: string; to?: string; saleId?: number }): Promise<
    {
      id: number
      returnNo: string
      saleId: number
      invoiceNo: string
      createdAt: string
      userName: string
      totalCents: number
      cashRefundCents: number
      debtReductionCents: number
      reason: string | null
    }[]
  >

  // Customers & Credits
  listCustomers(opts?: { search?: string; withDebtOnly?: boolean; includeInactive?: boolean }): Promise<CustomerRow[]>
  getCustomer(id: number): Promise<CustomerRow>
  saveCustomer(id: number | null, data: unknown): Promise<number>
  deleteCustomer(id: number): Promise<'deleted' | 'deactivated'>
  customerStatement(customerId: number, from?: string, to?: string): Promise<{
    customer: CustomerRow
    openingBalanceCents: number
    entries: StatementEntry[]
    closingBalanceCents: number
  }>
  recordCustomerPayment(data: unknown): Promise<{
    id: number
    receiptNo: string
    customerId: number
    customerName: string
    customerPhone: string | null
    amountCents: number
    method: string
    methodFr: string
    methodAr: string
    createdAt: string
    userName: string
    notes: string | null
    balanceAfterCents: number
  }>
  listCustomerPayments(opts?: { customerId?: number; from?: string; to?: string }): Promise<
    {
      id: number
      receiptNo: string
      customerId: number
      customerName: string
      amountCents: number
      method: string
      createdAt: string
      userName: string
      notes: string | null
    }[]
  >

  // Suppliers & Purchases
  listSuppliers(opts?: { search?: string; includeInactive?: boolean }): Promise<
    {
      id: number
      name: string
      phone: string | null
      address: string | null
      email: string | null
      notes: string | null
      active: boolean
      balanceCents: number
      purchaseCount: number
      createdAt: string
    }[]
  >
  saveSupplier(id: number | null, data: unknown): Promise<number>
  deleteSupplier(id: number): Promise<'deleted' | 'deactivated'>
  createPurchase(data: unknown): Promise<unknown>
  receivePurchase(purchaseId: number): Promise<unknown>
  addPurchasePayment(data: { purchaseId: number; amount: string | number; method: string; notes?: string | null }): Promise<unknown>
  createPurchaseReturn(data: unknown): Promise<unknown>
  getPurchase(id: number): Promise<unknown>
  listPurchases(opts?: { supplierId?: number; status?: string; from?: string; to?: string; search?: string }): Promise<unknown[]>

  // Expenses
  listExpenseCategories(): Promise<{ id: number; code: string | null; nameFr: string; nameAr: string; active: number }[]>
  saveExpenseCategory(input: { id?: number | null; nameFr: string; nameAr?: string }): Promise<number>
  saveExpense(id: number | null, data: unknown): Promise<number>
  deleteExpense(id: number): Promise<void>
  listExpenses(opts?: { from?: string; to?: string; categoryId?: number; search?: string }): Promise<{
    items: {
      id: number
      description: string
      categoryId: number
      categoryNameFr: string
      categoryNameAr: string
      amountCents: number
      expenseDate: string
      method: string
      methodFr: string
      methodAr: string
      notes: string | null
      userName: string
      createdAt: string
    }[]
    totalCents: number
    byCategory: { categoryId: number; nameFr: string; nameAr: string; totalCents: number }[]
    byMonth: { month: string; totalCents: number; count: number }[]
  }>

  // Reports
  getComprehensiveReport(filter: ReportFilter): Promise<ReturnType<typeof import('../main/services/reports').getComprehensiveReport>>
  exportReportCsv(filter: ReportFilter, section: 'products' | 'categories' | 'cashiers' | 'stock' | 'low_stock' | 'debts'): Promise<{ saved: boolean; filePath?: string }>
  exportReportPdf(filter: ReportFilter, html: string): Promise<{ saved: boolean; filePath?: string }>

  // Users & Audit
  listUsers(): Promise<
    {
      id: number
      username: string
      fullName: string
      role: 'ADMIN' | 'CASHIER'
      active: boolean
      mustChangePassword: boolean
      lastLoginAt: string | null
      createdAt: string
    }[]
  >
  saveUser(id: number | null, data: unknown): Promise<number>
  getRolePermissions(): Promise<{ ADMIN: string[]; CASHIER: string[]; all: string[] }>
  setCashierPermissions(perms: string[]): Promise<void>
  listAuditLogs(opts?: { limit?: number; userId?: number; action?: string; from?: string; to?: string }): Promise<
    {
      id: number
      action: string
      entity: string | null
      entityId: number | null
      details: string | null
      createdAt: string
      username: string | null
      fullName: string | null
    }[]
  >

  // Settings
  getSettings(): Promise<AppSettings>
  updateSettings(partial: Partial<AppSettings>): Promise<AppSettings>

  // Printing & Receipts
  listPrinters(): Promise<{ name: string; displayName: string; isDefault: boolean }[]>
  getSaleReceiptHtml(saleId: number, widthMm?: 58 | 80): Promise<string>
  printSaleReceipt(saleId: number, action?: 'print' | 'pdf'): Promise<{ ok: boolean; mode: string; filePath?: string; message: string }>
  getCustomerPaymentReceiptHtml(paymentId: number): Promise<string>
  printCustomerPaymentReceipt(paymentId: number, action?: 'print' | 'pdf'): Promise<{ ok: boolean; mode: string; filePath?: string; message: string }>
  getCashSessionReportHtml(sessionId: number): Promise<string>
  printCashSessionReport(sessionId: number, action?: 'print' | 'pdf'): Promise<{ ok: boolean; mode: string; filePath?: string; message: string }>
  getBarcodeLabelsHtml(items: LabelSpec[]): Promise<string>
  printBarcodeLabels(items: LabelSpec[], action?: 'print' | 'pdf'): Promise<{ ok: boolean; mode: string; filePath?: string; message: string }>

  // Electronic Scale
  listSerialPorts(): Promise<{ path: string; manufacturer?: string; friendlyName?: string }[]>
  getScaleStatus(): Promise<ScaleStatus>
  readScaleWeight(): Promise<ScaleReading>
  setSimulatedScaleWeight(grams: number, stable?: boolean): Promise<ScaleReading>
  testScaleConnection(overrideConfig?: AppSettings['scale']): Promise<{ ok: boolean; simulated: boolean; reading: ScaleReading | null; message: string }>
  onScaleReading(cb: (reading: ScaleReading) => void): () => void

  // Backup & Restore
  listBackups(): Promise<BackupRecord[]>
  detectRemovableDrives(): Promise<RemovableDrive[]>
  chooseFolder(): Promise<string | null>
  chooseBackupFile(): Promise<string | null>
  createManualBackup(destination: 'local' | 'usb' | 'custom', customDir?: string): Promise<BackupRecord>
  verifyBackup(filePath: string): Promise<{ ok: boolean; sha256: string; sizeBytes: number; message: string }>
  restoreBackup(filePath: string): Promise<{ preRestoreBackupPath: string }>
  getDatabaseInfo(): Promise<{ dbPath: string; backupDir: string; integrityOk: boolean; integrityMessages: string[] }>
}

