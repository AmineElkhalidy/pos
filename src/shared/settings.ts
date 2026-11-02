/**
 * Application settings schema + defaults. Persisted per-section in the `settings` table
 * (key = section name, value = JSON). Missing keys are filled from defaults on read,
 * so adding new settings never breaks existing databases.
 */
import { z } from 'zod'

export const storeSettingsSchema = z.object({
  name: z.string().max(120),
  address: z.string().max(300),
  phone: z.string().max(60),
  email: z.string().max(120),
  ice: z.string().max(40),
  taxId: z.string().max(40),
  logoDataUrl: z.string().max(400000)
})

export const generalSettingsSchema = z.object({
  language: z.enum(['fr', 'ar']),
  currencySymbolFr: z.string().max(10),
  currencySymbolAr: z.string().max(10),
  dateFormat: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy']),
  theme: z.enum(['light', 'dark']),
  sidebarCompact: z.boolean()
})

export const salesSettingsSchema = z.object({
  allowNegativeStock: z.boolean(),
  requireCashSession: z.boolean(),
  maxCashierDiscountPercent: z.number().min(0).max(100),
  enforceMinPrice: z.boolean(),
  invoicePrefix: z.string().max(10),
  qtyDecimals: z.number().int().min(0).max(3),
  weightStepGrams: z.number().int().min(1).max(1000),
  allowCreditSales: z.boolean(),
  defaultCreditLimitCents: z.number().int().min(0).nullable(),
  blockOverCreditLimit: z.boolean()
})

export const receiptSettingsSchema = z.object({
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  mode: z.enum(['driver', 'escpos-network', 'escpos-serial', 'pdf']),
  printerName: z.string(),
  networkHost: z.string(),
  networkPort: z.number().int().min(1).max(65535),
  serialPath: z.string(),
  serialBaud: z.number().int(),
  headerText: z.string().max(500),
  footerText: z.string().max(500),
  showLogo: z.boolean(),
  autoPrint: z.boolean(),
  copies: z.number().int().min(1).max(5),
  openDrawer: z.boolean(),
  bilingual: z.boolean()
})

export const labelSettingsSchema = z.object({
  printerName: z.string(),
  widthMm: z.number().min(15).max(150),
  heightMm: z.number().min(10).max(150),
  format: z.enum(['EAN13', 'CODE128']),
  showName: z.boolean(),
  showPrice: z.boolean(),
  showSku: z.boolean(),
  showStoreName: z.boolean(),
  fontSizePt: z.number().min(5).max(20),
  internalEanPrefix: z.string().regex(/^2\d$/),
  code128Prefix: z.string().max(6)
})

export const scaleSettingsSchema = z.object({
  enabled: z.boolean(),
  adapter: z.enum(['simulated', 'generic', 'cas', 'toledo']),
  port: z.string(),
  baudRate: z.number().int(),
  dataBits: z.union([z.literal(7), z.literal(8)]),
  parity: z.enum(['none', 'even', 'odd']),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  pollCommand: z.string().max(20),
  pollIntervalMs: z.number().int().min(100).max(5000),
  weightUnit: z.enum(['kg', 'g'])
})

export const stockSettingsSchema = z.object({
  lowStockAlerts: z.boolean(),
  expiryAlertDays: z.number().int().min(0).max(365)
})

export const backupSettingsSchema = z.object({
  autoEnabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  localDir: z.string(),
  usbDir: z.string(),
  autoToUsb: z.boolean(),
  keepCount: z.number().int().min(3).max(500),
  backupOnExit: z.boolean()
})

export const settingsSchema = z.object({
  store: storeSettingsSchema,
  general: generalSettingsSchema,
  sales: salesSettingsSchema,
  receipt: receiptSettingsSchema,
  labels: labelSettingsSchema,
  scale: scaleSettingsSchema,
  stock: stockSettingsSchema,
  backup: backupSettingsSchema
})

export type AppSettings = z.infer<typeof settingsSchema>
export type SettingsSection = keyof AppSettings

export const DEFAULT_SETTINGS: AppSettings = {
  store: { name: 'Smart POS', address: '', phone: '', email: '', ice: '', taxId: '', logoDataUrl: '' },
  general: {
    language: 'fr',
    currencySymbolFr: 'DH',
    currencySymbolAr: 'د.م.',
    dateFormat: 'dd/MM/yyyy',
    theme: 'light',
    sidebarCompact: false
  },
  sales: {
    allowNegativeStock: false,
    requireCashSession: true,
    maxCashierDiscountPercent: 10,
    enforceMinPrice: true,
    invoicePrefix: 'F',
    qtyDecimals: 3,
    weightStepGrams: 1,
    allowCreditSales: true,
    defaultCreditLimitCents: null,
    blockOverCreditLimit: true
  },
  receipt: {
    paperWidth: 80,
    mode: 'driver',
    printerName: '',
    networkHost: '192.168.1.100',
    networkPort: 9100,
    serialPath: '',
    serialBaud: 9600,
    headerText: '',
    footerText: 'Merci pour votre visite ! شكرا لزيارتكم',
    showLogo: true,
    autoPrint: false,
    copies: 1,
    openDrawer: false,
    bilingual: true
  },
  labels: {
    printerName: '',
    widthMm: 50,
    heightMm: 30,
    format: 'EAN13',
    showName: true,
    showPrice: true,
    showSku: false,
    showStoreName: false,
    fontSizePt: 8,
    internalEanPrefix: '21',
    code128Prefix: 'SP'
  },
  scale: {
    enabled: false,
    adapter: 'simulated',
    port: '',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    pollCommand: '',
    pollIntervalMs: 300,
    weightUnit: 'kg'
  },
  stock: { lowStockAlerts: true, expiryAlertDays: 30 },
  backup: {
    autoEnabled: true,
    intervalHours: 24,
    localDir: '',
    usbDir: '',
    autoToUsb: false,
    keepCount: 30,
    backupOnExit: true
  }
}

