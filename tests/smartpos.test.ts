import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, integrityCheck, type DB } from '../src/main/db/connection'
import { INITIAL_ADMIN } from '../src/main/db/seed'
import { login, saveUser, setCashierPermissions } from '../src/main/services/users'
import {
  saveCategory,
  saveProduct,
  getProduct,
  listProducts,
  lookupByCode,
  addBarcode,
  exportProductsCsv,
  importProductsCsv
} from '../src/main/services/products'
import { translateError } from '../src/renderer/src/i18n'
import { openSession, closeSession } from '../src/main/services/cash'
import { createSale, createSaleReturn, recordCustomerPayment } from '../src/main/services/sales'
import { saveCustomer, getCustomerBalance, customerStatement, saveSupplier } from '../src/main/services/partners'
import { createPurchase, createPurchaseReturn, addPurchasePayment } from '../src/main/services/purchases'
import { manualMovement, listMovements, createInventoryCount, setCountedQty, finalizeInventoryCount, getInventoryCount } from '../src/main/services/stock'
import { saveExpense, listExpenseCategories } from '../src/main/services/expenses'
import { getDashboardData, getComprehensiveReport } from '../src/main/services/reports'
import { createBackup, verifyBackupFile, restoreFromBackup } from '../src/main/services/backup'
import { GenericAsciiScaleAdapter, CasScaleAdapter, MettlerToledoScaleAdapter, scaleService } from '../src/main/services/scale'
import {
  buildSaleReceiptHtml,
  buildCustomerPaymentReceiptHtml,
  buildCashSessionReportHtml,
  buildBarcodeLabelsHtml
} from '../src/main/services/printing'
import { convertQty, toProductMilli } from '../src/shared/units'
import { toCents, lineAmount } from '../src/shared/money'
import { isValidEan13, isInternalEan13 } from '../src/shared/barcode'
import type { Ctx } from '../src/main/services/common'

describe('Smart POS — Core Business Logic & Data Integrity Suite', () => {
  let tempDir: string
  let dbPath: string
  let db: DB
  let adminCtx: Ctx

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'smartpos-test-'))
    dbPath = join(tempDir, 'smartpos.sqlite')
    db = openDatabase(dbPath)
    const adminUser = login(db, INITIAL_ADMIN.username, INITIAL_ADMIN.password)
    adminCtx = { db, user: adminUser }
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('1. creates and edits Moroccan retail products with accurate prices and initial stock', () => {
    const catEpicerie = saveCategory(adminCtx, null, { nameFr: 'Épicerie & Terroir', nameAr: 'بقالة ومنتجات محلية' })
    const oliveId = saveProduct(adminCtx, null, {
      nameFr: "Huile d'olive extra vierge",
      nameAr: 'زيت الزيتون',
      sku: 'OLIV-01',
      categoryId: catEpicerie,
      unitCode: 'L',
      productType: 'volume',
      purchasePrice: '60.00',
      salePrice: '80.00',
      minSalePrice: '75.00',
      initialStock: '25.5',
      minStock: '5',
      barcodes: [{ code: '6111000000012', isPrimary: true }]
    })

    let prod = getProduct(db, oliveId)
    expect(prod.nameFr).toBe("Huile d'olive extra vierge")
    expect(prod.nameAr).toBe('زيت الزيتون')
    expect(prod.purchasePriceCents).toBe(6000)
    expect(prod.salePriceCents).toBe(8000)
    expect(prod.stockMilli).toBe(25500)

    // Edit price & Arabic name
    saveProduct(adminCtx, oliveId, {
      nameFr: "Huile d'olive Beldi",
      nameAr: 'زيت الزيتون البلدي',
      sku: 'OLIV-01',
      categoryId: catEpicerie,
      unitCode: 'L',
      productType: 'volume',
      purchasePrice: '62.00',
      salePrice: '85.00',
      minSalePrice: '78.00',
      minStock: '5',
      barcodes: [{ code: '6111000000012', isPrimary: true }]
    })
    prod = getProduct(db, oliveId)
    expect(prod.nameFr).toBe("Huile d'olive Beldi")
    expect(prod.salePriceCents).toBe(8500)
    // Stock must remain untouched by product edit
    expect(prod.stockMilli).toBe(25500)
  })

  it('2 & 3. enforces barcode uniqueness, generates valid internal store EAN-13 (20-29), and supports multi-barcode lookup', () => {
    const honeyId = saveProduct(adminCtx, null, {
      nameFr: 'Miel pur de thym',
      nameAr: 'عسل حر',
      sku: 'MIEL-01',
      unitCode: 'kg',
      productType: 'weight',
      purchasePrice: '180',
      salePrice: '250',
      generateBarcode: 'EAN13'
    })
    const honey = getProduct(db, honeyId)
    expect(honey.barcodes.length).toBe(1)
    const internalCode = honey.barcodes[0].code
    expect(isValidEan13(internalCode)).toBe(true)
    expect(isInternalEan13(internalCode)).toBe(true) // Starts with 2x (in-store restricted circulation)

    // Add a second barcode (Code 128) to the same product
    const secondCode = addBarcode(adminCtx, honeyId, 'MIEL-POT-500', null)
    expect(secondCode).toBe('MIEL-POT-500')

    // Lookup by primary EAN-13, secondary barcode, and SKU
    expect(lookupByCode(db, internalCode)?.id).toBe(honeyId)
    expect(lookupByCode(db, 'MIEL-POT-500')?.id).toBe(honeyId)
    expect(lookupByCode(db, 'MIEL-01')?.id).toBe(honeyId)

    // Attempting to assign the same barcode to another product must fail
    expect(() =>
      saveProduct(adminCtx, null, {
        nameFr: 'Sucre granulé',
        nameAr: 'سكر',
        unitCode: 'kg',
        productType: 'standard',
        purchasePrice: '8',
        salePrice: '10',
        barcodes: [{ code: internalCode }]
      })
    ).toThrow(/BARCODE_EXISTS/)
  })

  it('4 & 5. performs decimal-safe unit conversions and weight/volume pricing without floating-point drift', () => {
    // 1 kg = 1000 g; 1 L = 1000 ml
    expect(convertQty(1, 'kg', 'g')).toBe(1000)
    expect(convertQty(250, 'ml', 'L')).toBe(0.25)

    // Olive oil at 80 DH/L -> 250 ml must equal 20.00 DH (2000 centimes)
    const oliveMilli = toProductMilli(250, 'ml', 'L')
    expect(oliveMilli).toBe(250)
    expect(lineAmount(oliveMilli, toCents('80.00'))).toBe(2000)

    // Thyme (زعتر) at 200 DH/kg -> 350 g must equal 70.00 DH (7000 centimes)
    const thymeMilli = toProductMilli(350, 'g', 'kg')
    expect(thymeMilli).toBe(350)
    expect(lineAmount(thymeMilli, toCents('200.00'))).toBe(7000)

    // Saffron / Spices: 125 g at 199.90 DH/kg = 24.99 DH (2499 centimes)
    const spiceMilli = toProductMilli(125, 'g', 'kg')
    expect(lineAmount(spiceMilli, toCents('199.90'))).toBe(2499)
  })

  it('6, 7 & 8. processes POS sales with weight items, line & cart discounts, split payments, and stock deductions', () => {
    openSession(adminCtx, '500.00', 'Ouverture test')
    const thymeId = saveProduct(adminCtx, null, {
      nameFr: 'Thym Beldi',
      nameAr: 'زعتر',
      unitCode: 'kg',
      productType: 'weight',
      purchasePrice: '120',
      salePrice: '200',
      initialStock: '5' // 5 kg = 5000 g
    })
    const oliveId = saveProduct(adminCtx, null, {
      nameFr: "Huile d'olive",
      nameAr: 'زيت الزيتون',
      unitCode: 'L',
      productType: 'volume',
      purchasePrice: '60',
      salePrice: '80',
      initialStock: '10' // 10 L
    })
    const milkId = saveProduct(adminCtx, null, {
      nameFr: 'Lait frais 1L',
      nameAr: 'حليب',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '6',
      salePrice: '7.50',
      initialStock: '40'
    })

    // Sale: 350 g thyme (70 DH) + 250 ml olive oil (20 DH) + 2 milk (15 DH, 5 DH line discount -> 10 DH)
    // Subtotal after line discount = 100 DH; 10% cart discount = 10 DH -> Total = 90 DH
    // Split payment: 40 DH CARD + 60 DH CASH tendered -> 50 DH cash applied + 10 DH change
    const sale = createSale(adminCtx, {
      items: [
        { productId: thymeId, qty: '350', entryUnit: 'g' },
        { productId: oliveId, qty: '250', entryUnit: 'ml' },
        { productId: milkId, qty: '2', entryUnit: 'pc', discount: { type: 'amount', value: '5.00' } }
      ],
      cartDiscount: { type: 'percent', value: 10 },
      payments: [
        { method: 'CARD', amount: '40.00' },
        { method: 'CASH', amount: '60.00' }
      ]
    })

    expect(sale.subtotalCents).toBe(10500) // 70 + 20 + 15 = 105 DH
    expect(sale.linesDiscountCents).toBe(500) // 5 DH
    expect(sale.cartDiscountCents).toBe(1000) // 10 DH
    expect(sale.totalCents).toBe(9000) // 90 DH
    expect(sale.paidCents).toBe(9000)
    expect(sale.changeCents).toBe(1000) // 10 DH change
    expect(sale.creditCents).toBe(0)

    // Verify exact stock deductions
    expect(getProduct(db, thymeId).stockMilli).toBe(4650) // 5.000 - 0.350 kg
    expect(getProduct(db, oliveId).stockMilli).toBe(9750) // 10.000 - 0.250 L
    expect(getProduct(db, milkId).stockMilli).toBe(38000) // 40 - 2 pcs
  })

  it('9 & 10. tracks credit sales, partial payments, debt repayments, credit limits, and customer statements', () => {
    openSession(adminCtx, '200.00')
    const cuminId = saveProduct(adminCtx, null, {
      nameFr: 'Cumin Beldi',
      nameAr: 'كمون',
      unitCode: 'kg',
      productType: 'weight',
      purchasePrice: '110',
      salePrice: '150',
      initialStock: '10'
    })
    const customerId = saveCustomer(adminCtx, null, {
      name: 'Mohamed El Amrani',
      phone: '0661234567',
      address: 'Quartier Habous, Casablanca',
      creditLimit: '500.00'
    })

    // Customer purchases 2 kg of cumin = 300 DH and pays 100 DH -> Outstanding debt = 200 DH
    const sale = createSale(adminCtx, {
      customerId,
      items: [{ productId: cuminId, qty: '2', entryUnit: 'kg' }],
      payments: [{ method: 'CASH', amount: '100.00' }]
    })
    expect(sale.totalCents).toBe(30000)
    expect(sale.paidCents).toBe(10000)
    expect(sale.creditCents).toBe(20000)
    expect(getCustomerBalance(db, customerId)).toBe(20000) // 200.00 DH

    // Partial repayment of 80 DH
    const pay1 = recordCustomerPayment(adminCtx, {
      customerId,
      amount: '80.00',
      method: 'CASH',
      notes: 'Premier acompte'
    })
    expect(pay1.balanceAfterCents).toBe(12000) // 120.00 DH remaining
    expect(getCustomerBalance(db, customerId)).toBe(12000)

    // Full settlement of remaining 120 DH
    const pay2 = recordCustomerPayment(adminCtx, {
      customerId,
      amount: '120.00',
      method: 'CARD',
      notes: 'Solde final'
    })
    expect(pay2.balanceAfterCents).toBe(0)
    expect(getCustomerBalance(db, customerId)).toBe(0)

    // Historical payment records must both exist in statement
    const st = customerStatement(db, customerId)
    expect(st.entries.length).toBe(3) // 1 sale + 2 separate payments
    expect(st.closingBalanceCents).toBe(0)

    // Exceeding the 500 DH credit limit must be blocked
    expect(() =>
      createSale(adminCtx, {
        customerId,
        items: [{ productId: cuminId, qty: '4', entryUnit: 'kg' }], // 600 DH
        payments: []
      })
    ).toThrow(/CREDIT_LIMIT_EXCEEDED/)
  })

  it('11, 12 & 13. records purchases, updates weighted-average cost, handles returns, and logs every stock movement', () => {
    openSession(adminCtx, '1000.00')
    const supplierId = saveSupplier(adminCtx, null, {
      name: 'Coopérative Atlas',
      phone: '0522001122',
      address: 'Beni Mellal'
    })
    const lentilsId = saveProduct(adminCtx, null, {
      nameFr: 'Lentilles Zaër',
      nameAr: 'عدس',
      unitCode: 'kg',
      productType: 'weight',
      purchasePrice: '10.00',
      salePrice: '16.00',
      initialStock: '10' // 10 kg @ 10 DH/kg
    })

    // Purchase 20 kg @ 13.00 DH/kg -> new stock = 30 kg, weighted average cost = (10*10 + 20*13)/30 = 12.00 DH
    const purchase = createPurchase(adminCtx, {
      supplierId,
      supplierInvoiceNo: 'FAC-2026-09',
      orderDate: '2026-10-31',
      receiveNow: true,
      items: [{ productId: lentilsId, qty: '20', unitCost: '13.00' }],
      initialPayment: { amount: '100.00', method: 'CASH' }
    })
    expect(purchase.totalCents).toBe(26000)
    expect(purchase.paidCents).toBe(10000)
    expect(purchase.remainingCents).toBe(16000)
    expect(purchase.paymentStatus).toBe('partial')

    const afterPurchase = getProduct(db, lentilsId)
    expect(afterPurchase.stockMilli).toBe(30000)
    expect(afterPurchase.avgCostCents).toBe(1200) // 12.00 DH

    // Pay another 60 DH to supplier
    const updatedPurchase = addPurchasePayment(adminCtx, {
      purchaseId: purchase.id,
      amount: '60.00',
      method: 'CASH'
    })
    expect(updatedPurchase.paidCents).toBe(16000)

    // Return 2 kg damaged to supplier
    const afterReturn = createPurchaseReturn(adminCtx, {
      purchaseId: purchase.id,
      items: [{ purchaseItemId: purchase.items[0].id, qty: '2' }],
      reason: 'Sac endommagé'
    })
    expect(afterReturn.returnedCents).toBe(2600)
    expect(getProduct(db, lentilsId).stockMilli).toBe(28000)

    // Manual damage adjustment of 0.5 kg
    manualMovement(adminCtx, {
      productId: lentilsId,
      type: 'DAMAGE',
      direction: 'out',
      qty: '0.5',
      note: 'Perte étalage'
    })
    expect(getProduct(db, lentilsId).stockMilli).toBe(27500)

    // Inventory count discrepancy
    const countId = createInventoryCount(adminCtx, { notes: 'Inventaire mensuel' })
    const countView = getInventoryCount(db, countId)
    setCountedQty(adminCtx, countView.items[0].id, '27') // 0.5 kg less than expected 27.5 kg
    finalizeInventoryCount(adminCtx, countId)
    expect(getProduct(db, lentilsId).stockMilli).toBe(27000)

    // Verify complete stock movement history
    const movements = listMovements(db, { productId: lentilsId })
    expect(movements.map((m) => m.type)).toEqual([
      'INVENTORY',
      'DAMAGE',
      'PURCHASE_RETURN',
      'PURCHASE',
      'INITIAL_STOCK'
    ])
  })

  it('14. rolls back the entire transaction when a multi-item sale fails midway (atomicity)', () => {
    openSession(adminCtx, '300.00')
    const p1 = saveProduct(adminCtx, null, {
      nameFr: 'Paprika doux',
      nameAr: 'فلفلة حمراء',
      unitCode: 'kg',
      productType: 'weight',
      purchasePrice: '45',
      salePrice: '70',
      initialStock: '5'
    })
    const p2 = saveProduct(adminCtx, null, {
      nameFr: 'Sucre en morceaux',
      nameAr: 'سكر',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '10',
      salePrice: '12',
      initialStock: '2' // Only 2 in stock
    })

    // Item 1 has plenty of stock (1 kg <= 5 kg), Item 2 requests 5 pcs (> 2 pcs available)
    expect(() =>
      createSale(adminCtx, {
        items: [
          { productId: p1, qty: '1', entryUnit: 'kg' },
          { productId: p2, qty: '5', entryUnit: 'pc' }
        ],
        payments: [{ method: 'CASH', amount: '200' }]
      })
    ).toThrow(/INSUFFICIENT_STOCK/)

    // Item 1 stock MUST still be 5 kg and zero sales or movements recorded
    expect(getProduct(db, p1).stockMilli).toBe(5000)
    expect(getProduct(db, p2).stockMilli).toBe(2000)
    expect(listMovements(db, { type: 'SALE' }).length).toBe(0)
  })

  it('15. calculates gross profit and net profit using historical cost at the time of sale (not current purchase price)', () => {
    openSession(adminCtx, '500.00')
    const honeyId = saveProduct(adminCtx, null, {
      nameFr: 'Miel d’eucalyptus',
      nameAr: 'عسل حر',
      unitCode: 'kg',
      productType: 'weight',
      purchasePrice: '100.00', // Initial cost = 100 DH/kg
      salePrice: '160.00',
      initialStock: '5'
    })

    // Sell 1 kg when cost is 100 DH -> Revenue = 160 DH, Historical COGS = 100 DH, Gross Profit = 60 DH
    const sale = createSale(adminCtx, {
      items: [{ productId: honeyId, qty: '1', entryUnit: 'kg' }],
      payments: [{ method: 'CASH', amount: '160.00' }]
    })

    // Later, purchase price jumps to 140 DH/kg
    createPurchase(adminCtx, {
      orderDate: new Date().toISOString().slice(0, 10),
      receiveNow: true,
      items: [{ productId: honeyId, qty: '10', unitCost: '140.00' }]
    })
    expect(getProduct(db, honeyId).purchasePriceCents).toBe(14000)

    // Record an expense of 15 DH
    const expCatId = listExpenseCategories(db)[0].id
    saveExpense(adminCtx, null, {
      description: 'Transport marchandises',
      categoryId: expCatId,
      amount: '15.00',
      expenseDate: new Date().toISOString().slice(0, 10),
      method: 'CASH'
    })

    // Historical sale profit must still use 100 DH COGS -> Gross profit = 60 DH, Net profit = 45 DH
    const today = new Date().toISOString().slice(0, 10)
    const report = getComprehensiveReport(db, { from: today, to: today })
    expect(report.summary.netRevenueCents).toBe(16000)
    expect(report.summary.netCogsCents).toBe(10000)
    expect(report.summary.grossProfitCents).toBe(6000)
    expect(report.summary.expensesCents).toBe(1500)
    expect(report.summary.netProfitCents).toBe(4500)

    // Partial return of 0.5 kg reduces revenue by 80 DH and COGS by 50 DH -> Gross profit = 30 DH
    createSaleReturn(adminCtx, {
      saleId: sale.id,
      items: [{ saleItemId: sale.items[0].id, qty: '0.5' }],
      reason: 'Retour client'
    })
    const dash = getDashboardData(db)
    expect(dash.todayRevenueCents).toBe(8000)
    expect(dash.todayCogsCents).toBe(5000)
    expect(dash.todayGrossProfitCents).toBe(3000)
    expect(dash.todayNetProfitCents).toBe(1500)
  })

  it('16. performs WAL-safe online backup, verifies SHA-256 & integrity, and restores with a pre-restore safety backup', async () => {
    const pId = saveProduct(adminCtx, null, {
      nameFr: 'Huile d’Argan Cosmétique',
      nameAr: 'زيت أركان',
      unitCode: 'L',
      productType: 'volume',
      purchasePrice: '300',
      salePrice: '450',
      initialStock: '8'
    })

    const backupDir = join(tempDir, 'backups')
    const rec = await createBackup(db, {
      targetDir: backupDir,
      destinationType: 'local',
      userId: adminCtx.user.id
    })
    expect(rec.verified).toBe(true)
    expect(existsSync(rec.filePath)).toBe(true)

    const ver = verifyBackupFile(rec.filePath)
    expect(ver.ok).toBe(true)
    expect(ver.sha256).toBe(rec.sha256)

    // Mutate live database after backup (create another product)
    const extraId = saveProduct(adminCtx, null, {
      nameFr: 'Produit Temporaire',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '10',
      salePrice: '20'
    })
    expect(getProduct(db, extraId).nameFr).toBe('Produit Temporaire')

    // Restore from the backup
    const restoreRes = await restoreFromBackup(adminCtx, rec.filePath, backupDir)
    expect(existsSync(restoreRes.preRestoreBackupPath)).toBe(true)
    expect(getProduct(db, pId).nameFr).toBe('Huile d’Argan Cosmétique')
    expect(() => getProduct(db, extraId)).toThrow(/PRODUCT_NOT_FOUND/)
    expect(integrityCheck(db).ok).toBe(true)
  })

  it('17. enforces role-based permissions, cashier discount limits, and cash session ownership', () => {
    const cashierId = saveUser(adminCtx, null, {
      username: 'caissier1',
      fullName: 'Youssef Bennani',
      role: 'CASHIER',
      active: true,
      password: 'password123'
    })
    expect(cashierId).toBeGreaterThan(0)
    const cashierUser = login(db, 'caissier1', 'password123')
    const cashierCtx: Ctx = { db, user: cashierUser }

    // Admin opens a session; Cashier 1 cannot close Admin's session
    const adminSession = openSession(adminCtx, '400.00')
    expect(() => closeSession(cashierCtx, adminSession.id, '400.00')).toThrow(/CANNOT_CLOSE_OTHER_SESSION/)

    // Cashier opens their own session
    const cashierSession = openSession(cashierCtx, '200.00')
    expect(cashierSession.userId).toBe(cashierUser.id)

    const prodId = saveProduct(adminCtx, null, {
      nameFr: 'Thé Vert Sultan',
      nameAr: 'أتاي',
      unitCode: 'pack',
      productType: 'pack',
      purchasePrice: '14',
      salePrice: '20',
      minSalePrice: '18',
      initialStock: '50'
    })

    // Cashier discount exceeding maxCashierDiscountPercent (default 10%) is rejected
    expect(() =>
      createSale(cashierCtx, {
        items: [{ productId: prodId, qty: '1' }],
        cartDiscount: { type: 'percent', value: 25 },
        payments: [{ method: 'CASH', amount: '20' }]
      })
    ).toThrow(/DISCOUNT_EXCEEDS_LIMIT/)

    // Admin revokes `pos.discount` from CASHIER role -> any discount by cashier is rejected
    setCashierPermissions(adminCtx, ['pos.sell', 'cash.open_close'])
    const refreshedCashier = login(db, 'caissier1', 'password123')
    expect(() =>
      createSale(
        { db, user: refreshedCashier },
        {
          items: [{ productId: prodId, qty: '1' }],
          cartDiscount: { type: 'amount', value: '1' },
          payments: [{ method: 'CASH', amount: '20' }]
        }
      )
    ).toThrow(/FORBIDDEN/)
  })

  it('18. supports CSV export/import and scale protocol adapters (Generic, CAS, Mettler-Toledo, Simulated)', () => {
    saveProduct(adminCtx, null, {
      nameFr: 'Eau minérale Sidi Ali 1.5L',
      nameAr: 'ماء معدني',
      sku: 'EAU-15',
      unitCode: 'pc',
      productType: 'standard',
      purchasePrice: '3.50',
      salePrice: '5.00',
      initialStock: '100',
      barcodes: [{ code: '6111035000057', isPrimary: true }]
    })
    const csv = exportProductsCsv(db)
    expect(csv).toContain('Eau minérale Sidi Ali 1.5L')
    expect(csv).toContain('ماء معدني')

    const importRes = importProductsCsv(
      adminCtx,
      `sku,name_fr,name_ar,category,unit,type,purchase_price,sale_price,min_sale_price,stock,min_stock,barcodes,track_expiry,expiry_date,active\n` +
        `FAR-01,Farine Finot,دقيق الفينو,Épicerie,kg,weight,7.00,9.50,8.50,80,10,6111222333446,0,,1`
    )
    expect(importRes.created).toBe(1)
    expect(lookupByCode(db, '6111222333446')?.nameAr).toBe('دقيق الفينو')

    // Electronic scale frame parsers
    expect(GenericAsciiScaleAdapter.parseFrame('ST,GS,+000.350kg', 'kg')).toEqual({ weightGrams: 350, stable: true })
    expect(CasScaleAdapter.parseFrame('US,GS,+  1.250kg', 'kg')).toEqual({ weightGrams: 1250, stable: false })
    expect(MettlerToledoScaleAdapter.parseFrame('S S     0.750 kg', 'kg')).toEqual({ weightGrams: 750, stable: true })
    const sim = scaleService.setSimulatedWeight(425, true)
    expect(sim.simulated).toBe(true)
    expect(sim.weightGrams).toBe(425)
  })

  it('19. generates 58mm/80mm thermal receipts, payment receipts, cash session reports, and barcode labels', async () => {
    const sess = openSession(adminCtx, '300.00')
    const pId = saveProduct(adminCtx, null, {
      nameFr: 'Safran de Taliouine',
      nameAr: 'زعفران تاليوين',
      sku: 'SAF-01',
      unitCode: 'g',
      productType: 'weight',
      purchasePrice: '25.00',
      salePrice: '40.00',
      initialStock: '500',
      generateBarcode: 'EAN13'
    })
    const prod = getProduct(db, pId)
    const custId = saveCustomer(adminCtx, null, { name: 'Fatima Zahra', phone: '0611223344' })
    const sale = createSale(adminCtx, {
      customerId: custId,
      items: [{ productId: pId, qty: '5', entryUnit: 'g' }],
      payments: [{ method: 'CASH', amount: '100.00' }]
    })
    const pay = recordCustomerPayment(adminCtx, {
      customerId: custId,
      amount: '50.00',
      method: 'CASH'
    })

    const html80 = buildSaleReceiptHtml(db, sale.id, 80)
    const html58 = buildSaleReceiptHtml(db, sale.id, 58)
    expect(html80).toContain(sale.invoiceNo)
    expect(html80).toContain('Safran de Taliouine')
    expect(html58).toContain('58mm')

    const payHtml = buildCustomerPaymentReceiptHtml(db, pay.id)
    expect(payHtml).toContain(pay.receiptNo)
    expect(payHtml).toContain('Fatima Zahra')

    const sessHtml = buildCashSessionReportHtml(db, sess.id)
    expect(sessHtml).toContain(`#${sess.id}`)

    const labelsHtml = await buildBarcodeLabelsHtml(db, [
      {
        productName: prod.nameFr,
        productNameAr: prod.nameAr,
        sku: prod.sku,
        barcode: prod.barcodes[0].code,
        priceCents: prod.salePriceCents,
        unitCode: prod.unitCode,
        copies: 2
      }
    ])
    expect(labelsHtml).toContain('data:image/png;base64,')
    expect(labelsHtml).toContain('Safran de Taliouine')
  })

  it('20. provides specific login error codes/translations and persists product images across create/edit/list', () => {
    // Unknown username -> USER_NOT_FOUND
    expect(() => login(db, 'unknown_user', 'anypass')).toThrow(/USER_NOT_FOUND/)
    // Wrong password -> WRONG_PASSWORD
    try {
      login(db, INITIAL_ADMIN.username, 'wrong_password_123')
      expect.unreachable('Should have thrown WRONG_PASSWORD')
    } catch (err: unknown) {
      const e = err as { code?: string; params?: Record<string, unknown> }
      expect(e.code).toBe('WRONG_PASSWORD')
      const frMsg = translateError(e, 'fr')
      const arMsg = translateError(e, 'ar')
      expect(frMsg).toContain('Mot de passe incorrect')
      expect(arMsg).toContain('كلمة المرور غير صحيحة')
    }

    // Product image upload, list hydration, and removal
    const sampleDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const arganId = saveProduct(adminCtx, null, {
      nameFr: "Huile d'Argan Bio",
      nameAr: 'زيت أركان حر',
      unitCode: 'L',
      productType: 'volume',
      purchasePrice: '280',
      salePrice: '420',
      image: sampleDataUrl
    })

    const fetched = getProduct(db, arganId)
    expect(fetched.image).toBe(sampleDataUrl)

    const listed = listProducts(db, { search: 'Argan' })
    expect(listed.items[0].image).toBe(sampleDataUrl)

    // Removing the image
    saveProduct(adminCtx, arganId, {
      nameFr: "Huile d'Argan Bio",
      nameAr: 'زيت أركان حر',
      unitCode: 'L',
      productType: 'volume',
      purchasePrice: '280',
      salePrice: '420',
      image: null
    })
    expect(getProduct(db, arganId).image).toBeNull()
  })
})
