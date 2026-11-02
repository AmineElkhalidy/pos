import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResponse, SmartPosApi } from '@shared/ipc'
import type { ScaleReading } from '../main/services/scale'

class FrontendApiError extends Error {
  constructor(
    public code: string,
    public params: Record<string, string | number> = {},
    message?: string
  ) {
    super(message || code)
    this.name = 'FrontendApiError'
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResponse<T>
  if (!res.ok) {
    throw new FrontendApiError(res.code, res.params ?? {}, res.message)
  }
  return res.data
}

const api: SmartPosApi = {
  getSession: () => invoke('auth:getSession'),
  login: (username, password) => invoke('auth:login', username, password),
  logout: () => invoke('auth:logout'),
  changeOwnPassword: (current, next) => invoke('auth:changeOwnPassword', current, next),
  setLanguage: (lang) => invoke('auth:setLanguage', lang),

  getDashboard: () => invoke('dashboard:get'),

  listCategories: () => invoke('categories:list'),
  saveCategory: (id, data) => invoke('categories:save', id, data),
  deleteCategory: (id) => invoke('categories:delete', id),

  listProducts: (opts) => invoke('products:list', opts),
  getProduct: (id) => invoke('products:get', id),
  lookupByCode: (code) => invoke('products:lookupByCode', code),
  saveProduct: (id, data) => invoke('products:save', id, data),
  deleteProduct: (id) => invoke('products:delete', id),
  restoreProduct: (id) => invoke('products:restore', id),
  addBarcode: (productId, code, generate) => invoke('products:addBarcode', productId, code, generate),
  removeBarcode: (barcodeId) => invoke('products:removeBarcode', barcodeId),
  generateInternalBarcode: (format) => invoke('products:generateInternalBarcode', format),
  renderBarcodePng: (code, format) => invoke('products:renderBarcodePng', code, format),
  exportProductsCsv: () => invoke('products:exportCsv'),
  importProductsCsv: () => invoke('products:importCsv'),

  stockOverview: (opts) => invoke('stock:overview', opts),
  manualMovement: (data) => invoke('stock:manualMovement', data),
  listMovements: (opts) => invoke('stock:listMovements', opts),
  listInventoryCounts: () => invoke('stock:listInventoryCounts'),
  createInventoryCount: (opts) => invoke('stock:createInventoryCount', opts),
  getInventoryCount: (id) => invoke('stock:getInventoryCount', id),
  setCountedQty: (itemId, qty) => invoke('stock:setCountedQty', itemId, qty),
  finalizeInventoryCount: (id) => invoke('stock:finalizeInventoryCount', id),
  cancelInventoryCount: (id) => invoke('stock:cancelInventoryCount', id),

  currentCashSession: () => invoke('cash:current'),
  openCashSession: (opening, notes) => invoke('cash:open', opening, notes),
  closeCashSession: (sessionId, counted, notes) => invoke('cash:close', sessionId, counted, notes),
  listCashSessions: (opts) => invoke('cash:list', opts),
  listPaymentMethods: (includeInactive) => invoke('cash:listPaymentMethods', includeInactive),
  savePaymentMethod: (input) => invoke('cash:savePaymentMethod', input),

  createSale: (data) => invoke('sales:create', data),
  getSale: (id) => invoke('sales:get', id),
  listSales: (opts) => invoke('sales:list', opts),
  createSaleReturn: (data) => invoke('sales:createReturn', data),
  listReturns: (opts) => invoke('sales:listReturns', opts),

  listCustomers: (opts) => invoke('customers:list', opts),
  getCustomer: (id) => invoke('customers:get', id),
  saveCustomer: (id, data) => invoke('customers:save', id, data),
  deleteCustomer: (id) => invoke('customers:delete', id),
  customerStatement: (customerId, from, to) => invoke('customers:statement', customerId, from, to),
  recordCustomerPayment: (data) => invoke('customers:recordPayment', data),
  listCustomerPayments: (opts) => invoke('customers:listPayments', opts),

  listSuppliers: (opts) => invoke('suppliers:list', opts),
  saveSupplier: (id, data) => invoke('suppliers:save', id, data),
  deleteSupplier: (id) => invoke('suppliers:delete', id),
  createPurchase: (data) => invoke('purchases:create', data),
  receivePurchase: (purchaseId) => invoke('purchases:receive', purchaseId),
  addPurchasePayment: (data) => invoke('purchases:addPayment', data),
  createPurchaseReturn: (data) => invoke('purchases:createReturn', data),
  getPurchase: (id) => invoke('purchases:get', id),
  listPurchases: (opts) => invoke('purchases:list', opts),

  listExpenseCategories: () => invoke('expenses:listCategories'),
  saveExpenseCategory: (input) => invoke('expenses:saveCategory', input),
  saveExpense: (id, data) => invoke('expenses:save', id, data),
  deleteExpense: (id) => invoke('expenses:delete', id),
  listExpenses: (opts) => invoke('expenses:list', opts),

  getComprehensiveReport: (filter) => invoke('reports:get', filter),
  exportReportCsv: (filter, section) => invoke('reports:exportCsv', filter, section),
  exportReportPdf: (filter, html) => invoke('reports:exportPdf', filter, html),

  listUsers: () => invoke('users:list'),
  saveUser: (id, data) => invoke('users:save', id, data),
  getRolePermissions: () => invoke('users:getRolePermissions'),
  setCashierPermissions: (perms) => invoke('users:setCashierPermissions', perms),
  listAuditLogs: (opts) => invoke('users:listAuditLogs', opts),

  getSettings: () => invoke('settings:get'),
  updateSettings: (partial) => invoke('settings:update', partial),

  listPrinters: () => invoke('print:listPrinters'),
  getSaleReceiptHtml: (saleId, widthMm) => invoke('print:saleReceiptHtml', saleId, widthMm),
  printSaleReceipt: (saleId, action) => invoke('print:saleReceipt', saleId, action),
  getCustomerPaymentReceiptHtml: (paymentId) => invoke('print:customerPaymentHtml', paymentId),
  printCustomerPaymentReceipt: (paymentId, action) => invoke('print:customerPayment', paymentId, action),
  getCashSessionReportHtml: (sessionId) => invoke('print:cashSessionHtml', sessionId),
  printCashSessionReport: (sessionId, action) => invoke('print:cashSession', sessionId, action),
  getBarcodeLabelsHtml: (items) => invoke('print:barcodeLabelsHtml', items),
  printBarcodeLabels: (items, action) => invoke('print:barcodeLabels', items, action),

  listSerialPorts: () => invoke('scale:listPorts'),
  getScaleStatus: () => invoke('scale:status'),
  readScaleWeight: () => invoke('scale:readWeight'),
  setSimulatedScaleWeight: (grams, stable) => invoke('scale:setSimulatedWeight', grams, stable),
  testScaleConnection: (overrideConfig) => invoke('scale:testConnection', overrideConfig),
  onScaleReading: (cb: (reading: ScaleReading) => void) => {
    const handler = (_e: unknown, reading: ScaleReading) => cb(reading)
    ipcRenderer.on('scale:reading', handler)
    return () => ipcRenderer.removeListener('scale:reading', handler)
  },

  listBackups: () => invoke('backup:list'),
  detectRemovableDrives: () => invoke('backup:detectDrives'),
  chooseFolder: () => invoke('backup:chooseFolder'),
  chooseBackupFile: () => invoke('backup:chooseFile'),
  createManualBackup: (destination, customDir) => invoke('backup:createManual', destination, customDir),
  verifyBackup: (filePath) => invoke('backup:verify', filePath),
  restoreBackup: (filePath) => invoke('backup:restore', filePath),
  getDatabaseInfo: () => invoke('backup:dbInfo')
}

contextBridge.exposeInMainWorld('api', api)

