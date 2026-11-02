import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { integrityCheck, type DB } from './db/connection'
import { AppError, audit, getSettings, requirePerm, type Ctx, type SessionUser } from './services/common'
import * as usersSvc from './services/users'
import * as productsSvc from './services/products'
import * as stockSvc from './services/stock'
import * as partnersSvc from './services/partners'
import * as cashSvc from './services/cash'
import * as salesSvc from './services/sales'
import * as purchasesSvc from './services/purchases'
import * as expensesSvc from './services/expenses'
import * as reportsSvc from './services/reports'
import * as settingsSvc from './services/settings'
import * as backupSvc from './services/backup'
import * as printingSvc from './services/printing'
import { scaleService } from './services/scale'
import type { IpcResponse } from '@shared/ipc'

let activeUserId: number | null = null

export function registerIpcHandlers(getDb: () => DB, getDbPath: () => string): void {
  const getCtx = (): Ctx => {
    const db = getDb()
    if (!activeUserId) throw new AppError('UNAUTHENTICATED')
    const user = usersSvc.refreshSessionUser(db, activeUserId)
    if (!user) {
      activeUserId = null
      throw new AppError('UNAUTHENTICATED')
    }
    return { db, user }
  }

  const handle = <Args extends unknown[], R>(channel: string, fn: (...args: Args) => Promise<R> | R) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResponse<R>> => {
      try {
        const data = await fn(...(args as Args))
        return { ok: true, data }
      } catch (e) {
        if (e instanceof AppError) {
          return { ok: false, code: e.code, params: e.params, message: e.code }
        }
        if (e instanceof z.ZodError) {
          const first = e.issues[0]
          const field = first?.path?.join('.') || 'field'
          const detail = e.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join(', ')
          return { ok: false, code: 'VALIDATION_ERROR', params: { field, detail }, message: detail }
        }
        const msg = e instanceof Error ? e.message : String(e)
        if (/^[A-Z0-9_]+$/.test(msg)) {
          return { ok: false, code: msg, params: {}, message: msg }
        }
        return { ok: false, code: 'INTERNAL_ERROR', params: { detail: msg }, message: msg }
      }
    })
  }

  // Forward live scale readings to all renderer windows
  scaleService.onReading((reading) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('scale:reading', reading)
      }
    }
  })

  // ---------------- Auth & Session ----------------
  handle('auth:getSession', (): SessionUser | null => {
    if (!activeUserId) return null
    const u = usersSvc.refreshSessionUser(getDb(), activeUserId)
    if (!u) activeUserId = null
    return u
  })

  handle('auth:login', (username: string, password: string): SessionUser => {
    const u = usersSvc.login(getDb(), username, password)
    activeUserId = u.id
    return u
  })

  handle('auth:logout', () => {
    if (activeUserId) {
      audit(getDb(), activeUserId, 'LOGOUT', 'user', activeUserId)
      activeUserId = null
    }
  })

  handle('auth:changeOwnPassword', (current: string, next: string) => {
    usersSvc.changeOwnPassword(getCtx(), current, next)
  })

  handle('auth:setLanguage', (lang: 'fr' | 'ar') => {
    const db = getDb()
    if (activeUserId) {
      usersSvc.setLanguage(getCtx(), lang)
    }
    const s = getSettings(db)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'general',
      JSON.stringify({ ...s.general, language: lang })
    )
  })

  // ---------------- Dashboard ----------------
  handle('dashboard:get', () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'dashboard.view')
    return reportsSvc.getDashboardData(ctx.db)
  })

  // ---------------- Categories ----------------
  handle('categories:list', () => {
    const ctx = getCtx()
    return productsSvc.listCategories(ctx.db)
  })
  handle('categories:save', (id: number | null, data: unknown) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'categories.manage')
    return productsSvc.saveCategory(ctx, id, data)
  })
  handle('categories:delete', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'categories.manage')
    productsSvc.deleteCategory(ctx, id)
  })

  // ---------------- Products & Barcodes ----------------
  handle('products:list', (opts?: productsSvc.ProductListOptions) => {
    const ctx = getCtx()
    return productsSvc.listProducts(ctx.db, opts)
  })
  handle('products:get', (id: number) => {
    const ctx = getCtx()
    return productsSvc.getProduct(ctx.db, id)
  })
  handle('products:lookupByCode', (code: string) => {
    const ctx = getCtx()
    return productsSvc.lookupByCode(ctx.db, code)
  })
  handle('products:save', (id: number | null, data: unknown) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'products.manage')
    return productsSvc.saveProduct(ctx, id, data)
  })
  handle('products:delete', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'products.manage')
    return productsSvc.deleteProduct(ctx, id)
  })
  handle('products:restore', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'products.manage')
    productsSvc.restoreProduct(ctx, id)
  })
  handle('products:addBarcode', (productId: number, code: string | null, generate: 'EAN13' | 'CODE128' | null) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'barcodes.manage')
    return productsSvc.addBarcode(ctx, productId, code, generate)
  })
  handle('products:removeBarcode', (barcodeId: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'barcodes.manage')
    productsSvc.removeBarcode(ctx, barcodeId)
  })
  handle('products:generateInternalBarcode', (format: 'EAN13' | 'CODE128') => {
    const ctx = getCtx()
    return productsSvc.generateInternalBarcode(ctx.db, format)
  })
  handle('products:renderBarcodePng', (code: string, format?: 'EAN13' | 'CODE128' | 'AUTO') => {
    getCtx()
    return printingSvc.generateBarcodePngDataUrl(code, format)
  })
  handle('products:exportCsv', async () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'products.view')
    const csv = productsSvc.exportProductsCsv(ctx.db)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporter les produits (CSV)',
      defaultPath: `smartpos-produits-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { saved: false }
    writeFileSync(filePath, csv, 'utf8')
    return { saved: true, filePath }
  })
  handle('products:importCsv', async () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'products.manage')
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importer des produits (CSV)',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePaths.length) return null
    const text = readFileSync(filePaths[0], 'utf8')
    return productsSvc.importProductsCsv(ctx, text)
  })

  // ---------------- Stock & Inventory ----------------
  handle('stock:overview', (opts?: { filter?: 'all' | 'low' | 'out' | 'expiring'; search?: string; categoryId?: number }) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.view')
    return stockSvc.stockOverview(ctx.db, opts ?? {})
  })
  handle('stock:manualMovement', (data: unknown) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.manage')
    return stockSvc.manualMovement(ctx, data)
  })
  handle('stock:listMovements', (opts?: { productId?: number; type?: string; from?: string; to?: string; limit?: number; search?: string }) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.view')
    return stockSvc.listMovements(ctx.db, opts ?? {})
  })
  handle('stock:listInventoryCounts', () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.view')
    return stockSvc.listInventoryCounts(ctx.db)
  })
  handle('stock:createInventoryCount', (opts: { categoryId?: number | null; notes?: string | null }) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.manage')
    return stockSvc.createInventoryCount(ctx, opts ?? {})
  })
  handle('stock:getInventoryCount', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.view')
    return stockSvc.getInventoryCount(ctx.db, id)
  })
  handle('stock:setCountedQty', (itemId: number, qty: string | number | null) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.manage')
    stockSvc.setCountedQty(ctx, itemId, qty)
  })
  handle('stock:finalizeInventoryCount', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.manage')
    return stockSvc.finalizeInventoryCount(ctx, id)
  })
  handle('stock:cancelInventoryCount', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'stock.manage')
    stockSvc.cancelInventoryCount(ctx, id)
  })

  // ---------------- Cash Sessions & Payment Methods ----------------
  handle('cash:current', () => cashSvc.currentSession(getCtx()))
  handle('cash:open', (opening: string | number, notes?: string | null) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'cash.open_close')
    return cashSvc.openSession(ctx, opening, notes)
  })
  handle('cash:close', (sessionId: number, counted: string | number, notes?: string | null) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'cash.open_close')
    return cashSvc.closeSession(ctx, sessionId, counted, notes)
  })
  handle('cash:list', (opts?: { userId?: number; status?: 'open' | 'closed'; limit?: number }) => {
    const ctx = getCtx()
    return cashSvc.listSessions(ctx.db, opts ?? {})
  })
  handle('cash:listPaymentMethods', (includeInactive?: boolean) => {
    const ctx = getCtx()
    return cashSvc.listPaymentMethods(ctx.db, includeInactive)
  })
  handle('cash:savePaymentMethod', (input: { code: string; nameFr: string; nameAr: string; active: boolean; sort?: number }) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'settings.manage')
    cashSvc.savePaymentMethod(ctx, input)
  })

  // ---------------- Sales & Returns ----------------
  handle('sales:create', (data: unknown) => salesSvc.createSale(getCtx(), data))
  handle('sales:get', (id: number) => salesSvc.getSale(getCtx().db, id))
  handle('sales:list', (opts?: Parameters<typeof salesSvc.listSales>[1]) => salesSvc.listSales(getCtx().db, opts ?? {}))
  handle('sales:createReturn', (data: unknown) => salesSvc.createSaleReturn(getCtx(), data))
  handle('sales:listReturns', (opts?: Parameters<typeof salesSvc.listReturns>[1]) => salesSvc.listReturns(getCtx().db, opts ?? {}))

  // ---------------- Customers & Credits ----------------
  handle('customers:list', (opts?: Parameters<typeof partnersSvc.listCustomers>[1]) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'customers.view')
    return partnersSvc.listCustomers(ctx.db, opts)
  })
  handle('customers:get', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'customers.view')
    return partnersSvc.getCustomer(ctx.db, id)
  })
  handle('customers:save', (id: number | null, data: unknown) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'customers.manage')
    return partnersSvc.saveCustomer(ctx, id, data)
  })
  handle('customers:delete', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'customers.manage')
    return partnersSvc.deleteCustomer(ctx, id)
  })
  handle('customers:statement', (customerId: number, from?: string, to?: string) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'credits.view')
    return partnersSvc.customerStatement(ctx.db, customerId, from, to)
  })
  handle('customers:recordPayment', (data: unknown) => salesSvc.recordCustomerPayment(getCtx(), data))
  handle('customers:listPayments', (opts?: Parameters<typeof salesSvc.listCustomerPayments>[1]) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'credits.view')
    return salesSvc.listCustomerPayments(ctx.db, opts ?? {})
  })

  // ---------------- Suppliers & Purchases ----------------
  handle('suppliers:list', (opts?: Parameters<typeof partnersSvc.listSuppliers>[1]) => {
    const ctx = getCtx()
    return partnersSvc.listSuppliers(ctx.db, opts)
  })
  handle('suppliers:save', (id: number | null, data: unknown) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'suppliers.manage')
    return partnersSvc.saveSupplier(ctx, id, data)
  })
  handle('suppliers:delete', (id: number) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'suppliers.manage')
    return partnersSvc.deleteSupplier(ctx, id)
  })
  handle('purchases:create', (data: unknown) => purchasesSvc.createPurchase(getCtx(), data))
  handle('purchases:receive', (purchaseId: number) => purchasesSvc.receivePurchase(getCtx(), purchaseId))
  handle('purchases:addPayment', (data: Parameters<typeof purchasesSvc.addPurchasePayment>[1]) =>
    purchasesSvc.addPurchasePayment(getCtx(), data)
  )
  handle('purchases:createReturn', (data: unknown) => purchasesSvc.createPurchaseReturn(getCtx(), data))
  handle('purchases:get', (id: number) => purchasesSvc.getPurchase(getCtx().db, id))
  handle('purchases:list', (opts?: Parameters<typeof purchasesSvc.listPurchases>[1]) =>
    purchasesSvc.listPurchases(getCtx().db, opts)
  )

  // ---------------- Expenses ----------------
  handle('expenses:listCategories', () => expensesSvc.listExpenseCategories(getCtx().db))
  handle('expenses:saveCategory', (input: { id?: number | null; nameFr: string; nameAr?: string }) =>
    expensesSvc.saveExpenseCategory(getCtx(), input)
  )
  handle('expenses:save', (id: number | null, data: unknown) => expensesSvc.saveExpense(getCtx(), id, data))
  handle('expenses:delete', (id: number) => expensesSvc.deleteExpense(getCtx(), id))
  handle('expenses:list', (opts?: Parameters<typeof expensesSvc.listExpenses>[1]) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'expenses.view')
    return expensesSvc.listExpenses(ctx.db, opts)
  })

  // ---------------- Reports ----------------
  handle('reports:get', (filter: reportsSvc.ReportFilter) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'reports.view')
    return reportsSvc.getComprehensiveReport(ctx.db, filter)
  })
  handle(
    'reports:exportCsv',
    async (filter: reportsSvc.ReportFilter, section: 'products' | 'categories' | 'cashiers' | 'stock' | 'low_stock' | 'debts') => {
      const ctx = getCtx()
      requirePerm(ctx.user, 'reports.view')
      const csv = reportsSvc.exportReportCsv(ctx.db, filter, section)
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Exporter le rapport (CSV)',
        defaultPath: `smartpos-rapport-${section}-${filter.from}-${filter.to}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (canceled || !filePath) return { saved: false }
      writeFileSync(filePath, csv, 'utf8')
      return { saved: true, filePath }
    }
  )
  handle('reports:exportPdf', async (filter: reportsSvc.ReportFilter, html: string) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'reports.view')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exporter le rapport (PDF)',
      defaultPath: `smartpos-rapport-${filter.from}-${filter.to}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { saved: false }
    await printingSvc.renderHtmlToPdfOrPrint({ html, action: 'pdf', pdfPath: filePath })
    return { saved: true, filePath }
  })

  // ---------------- Users & Audit ----------------
  handle('users:list', () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'users.manage')
    return usersSvc.listUsers(ctx.db)
  })
  handle('users:save', (id: number | null, data: unknown) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'users.manage')
    return usersSvc.saveUser(ctx, id, data)
  })
  handle('users:getRolePermissions', () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'users.manage')
    return usersSvc.getRolePermissions(ctx.db)
  })
  handle('users:setCashierPermissions', (perms: string[]) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'users.manage')
    usersSvc.setCashierPermissions(ctx, perms)
  })
  handle('users:listAuditLogs', (opts?: Parameters<typeof usersSvc.listAuditLogs>[1]) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'audit.view')
    return usersSvc.listAuditLogs(ctx.db, opts ?? {})
  })

  // ---------------- Settings ----------------
  handle('settings:get', () => getSettings(getDb()))
  handle('settings:update', (partial: Parameters<typeof settingsSvc.updateSettings>[1]) =>
    settingsSvc.updateSettings(getCtx(), partial)
  )

  // ---------------- Printing & Receipts ----------------
  handle('print:listPrinters', () => printingSvc.listSystemPrinters())
  handle('print:saleReceiptHtml', (saleId: number, widthMm?: 58 | 80) =>
    printingSvc.buildSaleReceiptHtml(getCtx().db, saleId, widthMm)
  )
  handle('print:saleReceipt', async (saleId: number, action?: 'print' | 'pdf') => {
    const ctx = getCtx()
    const settings = getSettings(ctx.db)
    const html = printingSvc.buildSaleReceiptHtml(ctx.db, saleId)
    const sale = salesSvc.getSale(ctx.db, saleId)
    const mode = action === 'pdf' ? 'pdf' : settings.receipt.mode
    if (mode === 'pdf') {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: `Ticket ${sale.invoiceNo}`,
        defaultPath: `ticket-${sale.invoiceNo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, mode: 'pdf', message: 'Export annulé.' }
      return printingSvc.renderHtmlToPdfOrPrint({
        html,
        action: 'pdf',
        pdfPath: filePath,
        pageSizeMm: { width: settings.receipt.paperWidth, height: 220 }
      })
    }
    if (mode === 'escpos-network') {
      const buf = printingSvc.buildSaleEscPosBuffer(ctx.db, saleId)
      await printingSvc.sendEscPosNetwork(settings.receipt.networkHost, settings.receipt.networkPort, buf)
      return { ok: true, mode: 'escpos-network', message: `Envoyé à ${settings.receipt.networkHost}:${settings.receipt.networkPort}` }
    }
    if (mode === 'escpos-serial') {
      if (!settings.receipt.serialPath) throw new AppError('PRINTER_PORT_REQUIRED')
      const buf = printingSvc.buildSaleEscPosBuffer(ctx.db, saleId)
      await printingSvc.sendEscPosSerial(settings.receipt.serialPath, settings.receipt.serialBaud, buf)
      return { ok: true, mode: 'escpos-serial', message: `Envoyé sur ${settings.receipt.serialPath}` }
    }
    return printingSvc.renderHtmlToPdfOrPrint({
      html,
      action: 'print',
      printerName: settings.receipt.printerName,
      copies: settings.receipt.copies
    })
  })

  handle('print:customerPaymentHtml', (paymentId: number) =>
    printingSvc.buildCustomerPaymentReceiptHtml(getCtx().db, paymentId)
  )
  handle('print:customerPayment', async (paymentId: number, action?: 'print' | 'pdf') => {
    const ctx = getCtx()
    const settings = getSettings(ctx.db)
    const html = printingSvc.buildCustomerPaymentReceiptHtml(ctx.db, paymentId)
    const p = salesSvc.getCustomerPayment(ctx.db, paymentId)
    if (action === 'pdf' || settings.receipt.mode === 'pdf') {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: `Reçu ${p.receiptNo}`,
        defaultPath: `recu-${p.receiptNo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, mode: 'pdf', message: 'Export annulé.' }
      return printingSvc.renderHtmlToPdfOrPrint({
        html,
        action: 'pdf',
        pdfPath: filePath,
        pageSizeMm: { width: settings.receipt.paperWidth, height: 150 }
      })
    }
    return printingSvc.renderHtmlToPdfOrPrint({
      html,
      action: 'print',
      printerName: settings.receipt.printerName
    })
  })

  handle('print:cashSessionHtml', (sessionId: number) => printingSvc.buildCashSessionReportHtml(getCtx().db, sessionId))
  handle('print:cashSession', async (sessionId: number, action?: 'print' | 'pdf') => {
    const ctx = getCtx()
    const settings = getSettings(ctx.db)
    const html = printingSvc.buildCashSessionReportHtml(ctx.db, sessionId)
    if (action === 'pdf' || settings.receipt.mode === 'pdf') {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: `Clôture caisse #${sessionId}`,
        defaultPath: `cloture-caisse-${sessionId}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, mode: 'pdf', message: 'Export annulé.' }
      return printingSvc.renderHtmlToPdfOrPrint({
        html,
        action: 'pdf',
        pdfPath: filePath,
        pageSizeMm: { width: settings.receipt.paperWidth, height: 180 }
      })
    }
    return printingSvc.renderHtmlToPdfOrPrint({
      html,
      action: 'print',
      printerName: settings.receipt.printerName
    })
  })

  handle('print:barcodeLabelsHtml', (items: printingSvc.LabelSpec[]) =>
    printingSvc.buildBarcodeLabelsHtml(getCtx().db, items)
  )
  handle('print:barcodeLabels', async (items: printingSvc.LabelSpec[], action?: 'print' | 'pdf') => {
    const ctx = getCtx()
    const settings = getSettings(ctx.db)
    const html = await printingSvc.buildBarcodeLabelsHtml(ctx.db, items)
    const widthMm = items[0]?.widthMm ?? settings.labels.widthMm
    const heightMm = items[0]?.heightMm ?? settings.labels.heightMm
    if (action === 'pdf') {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Exporter les étiquettes (PDF)',
        defaultPath: `etiquettes-${new Date().toISOString().slice(0, 10)}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, mode: 'pdf', message: 'Export annulé.' }
      return printingSvc.renderHtmlToPdfOrPrint({
        html,
        action: 'pdf',
        pdfPath: filePath,
        pageSizeMm: { width: widthMm, height: heightMm }
      })
    }
    return printingSvc.renderHtmlToPdfOrPrint({
      html,
      action: 'print',
      printerName: settings.labels.printerName || settings.receipt.printerName,
      pageSizeMm: { width: widthMm, height: heightMm }
    })
  })

  // ---------------- Electronic Scale ----------------
  handle('scale:listPorts', () => scaleService.listPorts())
  handle('scale:status', () => scaleService.getStatus(getSettings(getDb()).scale))
  handle('scale:readWeight', () => scaleService.readWeight(getSettings(getDb()).scale))
  handle('scale:setSimulatedWeight', (grams: number, stable?: boolean) =>
    scaleService.setSimulatedWeight(grams, stable ?? true)
  )
  handle('scale:testConnection', (overrideConfig?: ReturnType<typeof getSettings>['scale']) =>
    scaleService.testConnection(overrideConfig ?? getSettings(getDb()).scale)
  )

  // ---------------- Backup & Restore ----------------
  handle('backup:list', () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'backup.manage')
    return backupSvc.listBackups(ctx.db)
  })
  handle('backup:detectDrives', () => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'backup.manage')
    return backupSvc.detectRemovableDrives()
  })
  handle('backup:chooseFolder', async () => {
    getCtx()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choisir le dossier de sauvegarde',
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled || !filePaths.length ? null : filePaths[0]
  })
  handle('backup:chooseFile', async () => {
    getCtx()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choisir un fichier de sauvegarde SQLite',
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde Smart POS (.sqlite, .db)', extensions: ['sqlite', 'db'] }]
    })
    return canceled || !filePaths.length ? null : filePaths[0]
  })
  handle('backup:createManual', async (destination: 'local' | 'usb' | 'custom', customDir?: string) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'backup.manage')
    const cfg = getSettings(ctx.db).backup
    let targetDir = customDir || ''
    if (destination === 'local') {
      targetDir = cfg.localDir || backupSvc.defaultBackupDirectory(app.getPath('userData'))
    } else if (destination === 'usb') {
      if (cfg.usbDir) {
        targetDir = cfg.usbDir
      } else {
        const drives = backupSvc.detectRemovableDrives()
        if (!drives.length) throw new AppError('NO_USB_DRIVE_DETECTED')
        targetDir = drives[0].backupPath
      }
    }
    if (!targetDir) throw new AppError('BACKUP_DIR_REQUIRED')
    return backupSvc.createBackup(ctx.db, {
      targetDir,
      destinationType: destination,
      userId: ctx.user.id
    })
  })
  handle('backup:verify', (filePath: string) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'backup.manage')
    return backupSvc.verifyBackupFile(filePath)
  })
  handle('backup:restore', async (filePath: string) => {
    const ctx = getCtx()
    requirePerm(ctx.user, 'backup.manage')
    const safetyDir = join(app.getPath('userData'), 'backups')
    const res = await backupSvc.restoreFromBackup(ctx, filePath, safetyDir)
    return res
  })
  handle('backup:dbInfo', () => {
    const ctx = getCtx()
    const ic = integrityCheck(ctx.db)
    const cfg = getSettings(ctx.db).backup
    return {
      dbPath: getDbPath(),
      backupDir: cfg.localDir || backupSvc.defaultBackupDirectory(app.getPath('userData')),
      integrityOk: ic.ok,
      integrityMessages: ic.messages
    }
  })
}
