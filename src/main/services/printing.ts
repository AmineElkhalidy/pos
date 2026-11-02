import bwipjs from 'bwip-js'
import { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { SerialPort } from 'serialport'
import type { DB } from '../db/connection'
import { getSettings } from './common'
import { getSale, getCustomerPayment } from './sales'
import { computeSession } from './cash'
import { formatMoney, formatQty } from '@shared/money'
import { detectFormat } from '@shared/barcode'

/** Generates a PNG data URL for a barcode using bwip-js. */
export async function generateBarcodePngDataUrl(
  code: string,
  format?: 'EAN13' | 'CODE128' | 'AUTO',
  opts?: { heightMm?: number; includeText?: boolean }
): Promise<string> {
  const detected = format && format !== 'AUTO' ? format : detectFormat(code)
  const bcid = detected === 'EAN13' && /^\d{12,13}$/.test(code) ? 'ean13' : 'code128'
  const png = await bwipjs.toBuffer({
    bcid,
    text: code,
    scale: 3,
    height: Math.max(8, Math.min(25, opts?.heightMm ?? 12)),
    includetext: opts?.includeText ?? true,
    textxalign: 'center',
    backgroundcolor: 'FFFFFF'
  })
  return `data:image/png;base64,${png.toString('base64')}`
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Builds complete thermal receipt HTML (58mm or 80mm) for preview, driver printing, or PDF export. */
export function buildSaleReceiptHtml(db: DB, saleId: number, overrideWidth?: 58 | 80): string {
  const settings = getSettings(db)
  const sale = getSale(db, saleId)
  const widthMm = overrideWidth ?? settings.receipt.paperWidth
  const bilingual = settings.receipt.bilingual
  const dt = new Date(sale.createdAt).toLocaleString('fr-MA')
  const discountTotal = sale.linesDiscountCents + sale.cartDiscountCents

  const rowsHtml = sale.items
    .map((it) => {
      const qtyLabel =
        it.entryUnit && it.entryUnit !== it.unitCode && it.entryQty
          ? `${escapeHtml(it.entryQty)} ${escapeHtml(it.entryUnit)} (${formatQty(it.qtyMilli)} ${escapeHtml(it.unitCode)})`
          : `${formatQty(it.qtyMilli)} ${escapeHtml(it.unitCode)}`
      return `
      <tr>
        <td class="item-name">
          <div>${escapeHtml(it.productName)}</div>
          ${bilingual && it.productNameAr ? `<div class="ar">${escapeHtml(it.productNameAr)}</div>` : ''}
          <div class="sub">${qtyLabel} × ${formatMoney(it.unitPriceCents)}</div>
        </td>
        <td class="item-total">${formatMoney(it.totalCents)}</td>
      </tr>`
    })
    .join('')

  const paymentsHtml = sale.payments
    .map(
      (p) =>
        `<div class="row"><span>${escapeHtml(p.nameFr)}${bilingual ? ` / ${escapeHtml(p.nameAr)}` : ''}</span><span>${formatMoney(p.amountCents)}</span></div>`
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Ticket ${escapeHtml(sale.invoiceNo)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    width: ${widthMm - 4}mm;
    margin: 0 auto;
    padding: 2mm 1mm;
    color: #000;
    font-size: ${widthMm === 58 ? '10px' : '11.5px'};
    line-height: 1.35;
  }
  .center { text-align: center; }
  .store-title { font-size: ${widthMm === 58 ? '13px' : '15px'}; font-weight: 800; margin-bottom: 2px; }
  .muted { font-size: 0.9em; color: #222; }
  .divider { border-top: 1px dashed #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; }
  .row.bold { font-weight: 700; }
  .row.grand { font-size: 1.2em; font-weight: 800; padding: 3px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 2px 0; border-bottom: 1px dotted #ccc; }
  .item-name { width: 72%; }
  .item-total { width: 28%; text-align: right; font-weight: 600; white-space: nowrap; }
  .sub { font-size: 0.88em; color: #333; }
  .ar { direction: rtl; font-size: 0.92em; }
  .logo { max-width: 45%; max-height: 16mm; margin: 0 auto 3px; display: block; }
</style>
</head>
<body>
  <div class="center">
    ${settings.receipt.showLogo && settings.store.logoDataUrl ? `<img class="logo" src="${settings.store.logoDataUrl}" />` : ''}
    <div class="store-title">${escapeHtml(settings.store.name || 'Smart POS')}</div>
    ${settings.store.address ? `<div class="muted">${escapeHtml(settings.store.address)}</div>` : ''}
    ${settings.store.phone ? `<div class="muted">Tél: ${escapeHtml(settings.store.phone)}</div>` : ''}
    ${settings.store.ice ? `<div class="muted">ICE: ${escapeHtml(settings.store.ice)}</div>` : ''}
    ${settings.receipt.headerText ? `<div class="muted">${escapeHtml(settings.receipt.headerText)}</div>` : ''}
  </div>
  <div class="divider"></div>
  <div class="row"><span>Facture / فاتورة:</span><b>${escapeHtml(sale.invoiceNo)}</b></div>
  <div class="row"><span>Date / التاريخ:</span><span>${escapeHtml(dt)}</span></div>
  <div class="row"><span>Caissier / الصندوق:</span><span>${escapeHtml(sale.userName)}</span></div>
  ${sale.customerName ? `<div class="row"><span>Client / الزبون:</span><b>${escapeHtml(sale.customerName)}</b></div>` : ''}
  <div class="divider"></div>
  <table>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <div class="row"><span>Sous-total / المجموع الفرعي</span><span>${formatMoney(sale.subtotalCents)}</span></div>
  ${discountTotal > 0 ? `<div class="row"><span>Remise / التخفيض</span><span>-${formatMoney(discountTotal)}</span></div>` : ''}
  <div class="row grand"><span>TOTAL / المجموع</span><span>${formatMoney(sale.totalCents)}</span></div>
  ${paymentsHtml}
  ${sale.tenderedCents > sale.paidCents ? `<div class="row"><span>Reçu / المؤدى</span><span>${formatMoney(sale.tenderedCents)}</span></div>` : ''}
  ${sale.changeCents > 0 ? `<div class="row bold"><span>Monnaie rendue / الباقي</span><span>${formatMoney(sale.changeCents)}</span></div>` : ''}
  <div class="row bold"><span>Payé / المدفوع</span><span>${formatMoney(sale.paidCents)}</span></div>
  ${sale.creditCents > 0 ? `<div class="row bold"><span>Reste à payer (Crédit) / الدين</span><span>${formatMoney(sale.creditCents)}</span></div>` : ''}
  ${sale.customerBalanceCents !== null && sale.customerBalanceCents > 0 ? `<div class="row"><span>Solde client total / إجمالي الدين</span><span>${formatMoney(sale.customerBalanceCents)}</span></div>` : ''}
  <div class="divider"></div>
  <div class="center muted">${escapeHtml(settings.receipt.footerText)}</div>
</body>
</html>`
}

export function buildCustomerPaymentReceiptHtml(db: DB, paymentId: number): string {
  const settings = getSettings(db)
  const p = getCustomerPayment(db, paymentId)
  const widthMm = settings.receipt.paperWidth
  const dt = new Date(p.createdAt).toLocaleString('fr-MA')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Reçu ${escapeHtml(p.receiptNo)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; width: ${widthMm - 4}mm; margin: 0 auto; padding: 2mm; font-size: 11.5px; }
  .center { text-align: center; }
  .title { font-size: 14px; font-weight: 800; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; }
  .bold { font-weight: 700; }
</style>
</head>
<body>
  <div class="center">
    <div class="title">${escapeHtml(settings.store.name || 'Smart POS')}</div>
    ${settings.store.phone ? `<div>Tél: ${escapeHtml(settings.store.phone)}</div>` : ''}
    <div class="bold" style="margin-top:4px;">REÇU DE RÈGLEMENT CLIENT / وصل أداء</div>
  </div>
  <div class="divider"></div>
  <div class="row"><span>N° Reçu:</span><b>${escapeHtml(p.receiptNo)}</b></div>
  <div class="row"><span>Date:</span><span>${escapeHtml(dt)}</span></div>
  <div class="row"><span>Caissier:</span><span>${escapeHtml(p.userName)}</span></div>
  <div class="row"><span>Client / الزبون:</span><b>${escapeHtml(p.customerName)}</b></div>
  <div class="divider"></div>
  <div class="row bold"><span>Montant versé / المبلغ المؤدى:</span><span>${formatMoney(p.amountCents)}</span></div>
  <div class="row"><span>Mode:</span><span>${escapeHtml(p.methodFr)} / ${escapeHtml(p.methodAr)}</span></div>
  <div class="row bold"><span>Nouveau solde / الرصيد المتبقي:</span><span>${formatMoney(p.balanceAfterCents)}</span></div>
  ${p.notes ? `<div class="divider"></div><div>Note: ${escapeHtml(p.notes)}</div>` : ''}
  <div class="divider"></div>
  <div class="center">${escapeHtml(settings.receipt.footerText)}</div>
</body>
</html>`
}

export function buildCashSessionReportHtml(db: DB, sessionId: number): string {
  const settings = getSettings(db)
  const s = computeSession(db, sessionId)
  const widthMm = settings.receipt.paperWidth
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Clôture Caisse #${s.id}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; width: ${widthMm - 4}mm; margin: 0 auto; padding: 2mm; font-size: 11px; }
  .center { text-align: center; }
  .title { font-size: 14px; font-weight: 800; }
  .divider { border-top: 1px dashed #000; margin: 5px 0; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .bold { font-weight: 700; }
</style>
</head>
<body>
  <div class="center">
    <div class="title">${escapeHtml(settings.store.name || 'Smart POS')}</div>
    <div class="bold">RAPPORT DE CAISSE #${s.id} / تقرير الصندوق</div>
  </div>
  <div class="divider"></div>
  <div class="row"><span>Caissier:</span><b>${escapeHtml(s.userName)}</b></div>
  <div class="row"><span>Ouverture:</span><span>${escapeHtml(new Date(s.openedAt).toLocaleString('fr-MA'))}</span></div>
  <div class="row"><span>Clôture:</span><span>${escapeHtml(s.closedAt ? new Date(s.closedAt).toLocaleString('fr-MA') : 'En cours')}</span></div>
  <div class="divider"></div>
  <div class="row"><span>Fond de caisse initial:</span><span>${formatMoney(s.openingCents)}</span></div>
  <div class="row"><span>+ Ventes espèces:</span><span>${formatMoney(s.cashSalesCents)}</span></div>
  <div class="row"><span>+ Règlements clients (esp.):</span><span>${formatMoney(s.cashCustomerPaymentsCents)}</span></div>
  <div class="row"><span>- Remboursements espèces:</span><span>-${formatMoney(s.cashRefundsCents)}</span></div>
  <div class="row"><span>- Dépenses espèces:</span><span>-${formatMoney(s.cashExpensesCents)}</span></div>
  <div class="row"><span>- Paiements fournisseurs (esp.):</span><span>-${formatMoney(s.cashSupplierPaymentsCents)}</span></div>
  <div class="divider"></div>
  <div class="row bold"><span>Espèces théoriques:</span><span>${formatMoney(s.expectedCents)}</span></div>
  ${s.countedCents !== null ? `<div class="row bold"><span>Espèces comptées:</span><span>${formatMoney(s.countedCents)}</span></div>` : ''}
  ${s.differenceCents !== null ? `<div class="row bold"><span>Écart / الفرق:</span><span>${formatMoney(s.differenceCents)}</span></div>` : ''}
  <div class="divider"></div>
  <div class="row"><span>Nb ventes:</span><span>${s.salesCount}</span></div>
  <div class="row"><span>Total ventes:</span><span>${formatMoney(s.salesTotalCents)}</span></div>
  <div class="row"><span>Ventes hors-espèces:</span><span>${formatMoney(s.nonCashSalesCents)}</span></div>
  <div class="row"><span>Ventes à crédit:</span><span>${formatMoney(s.creditSalesCents)}</span></div>
</body>
</html>`
}

export interface LabelSpec {
  productName: string
  productNameAr?: string | null
  sku?: string | null
  barcode: string
  format?: 'EAN13' | 'CODE128'
  priceCents: number
  unitCode?: string
  copies?: number
  widthMm?: number
  heightMm?: number
  showName?: boolean
  showPrice?: boolean
  showSku?: boolean
  showStoreName?: boolean
}

export async function buildBarcodeLabelsHtml(db: DB, items: LabelSpec[]): Promise<string> {
  const settings = getSettings(db)
  const cfg = settings.labels
  const widthMm = items[0]?.widthMm ?? cfg.widthMm
  const heightMm = items[0]?.heightMm ?? cfg.heightMm

  const cards: string[] = []
  for (const item of items) {
    const pngUrl = await generateBarcodePngDataUrl(item.barcode, item.format ?? cfg.format, {
      heightMm: Math.max(8, Math.round(heightMm * 0.42)),
      includeText: true
    })
    const copies = Math.max(1, Math.min(200, item.copies ?? 1))
    const showName = item.showName ?? cfg.showName
    const showPrice = item.showPrice ?? cfg.showPrice
    const showSku = item.showSku ?? cfg.showSku
    const showStore = item.showStoreName ?? cfg.showStoreName
    const unitSuffix = item.unitCode && item.unitCode !== 'pc' ? ` / ${item.unitCode}` : ''
    for (let c = 0; c < copies; c++) {
      cards.push(`
        <div class="label">
          ${showStore ? `<div class="store">${escapeHtml(settings.store.name)}</div>` : ''}
          ${showName ? `<div class="name">${escapeHtml(item.productName)}${item.productNameAr ? ` · ${escapeHtml(item.productNameAr)}` : ''}</div>` : ''}
          <img class="bc" src="${pngUrl}" />
          <div class="bottom">
            ${showSku && item.sku ? `<span class="sku">${escapeHtml(item.sku)}</span>` : '<span></span>'}
            ${showPrice ? `<span class="price">${formatMoney(item.priceCents)}${escapeHtml(unitSuffix)}</span>` : ''}
          </div>
        </div>
      `)
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Étiquettes codes-barres</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; }
  .label {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    padding: 1.5mm 2mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    page-break-after: always;
    overflow: hidden;
  }
  .store { font-size: ${Math.max(6, cfg.fontSizePt - 2)}pt; color: #333; text-transform: uppercase; letter-spacing: 0.4px; }
  .name { font-size: ${cfg.fontSizePt}pt; font-weight: 700; text-align: center; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bc { max-width: 96%; max-height: ${Math.round(heightMm * 0.56)}mm; object-fit: contain; }
  .bottom { width: 100%; display: flex; justify-content: space-between; align-items: baseline; font-size: ${cfg.fontSizePt}pt; }
  .sku { font-size: ${Math.max(6, cfg.fontSizePt - 1.5)}pt; color: #333; }
  .price { font-weight: 800; font-size: ${cfg.fontSizePt + 1}pt; margin-left: auto; }
</style>
</head>
<body>${cards.join('')}</body>
</html>`
}

/** Builds raw ESC/POS bytes for network (port 9100) or serial thermal printers. */
export function buildSaleEscPosBuffer(db: DB, saleId: number): Buffer {
  const settings = getSettings(db)
  const sale = getSale(db, saleId)
  const cols = settings.receipt.paperWidth === 58 ? 32 : 48
  const line = (ch = '-') => ch.repeat(cols) + '\n'
  const lr = (left: string, right: string) => {
    const space = Math.max(1, cols - left.length - right.length)
    return left.slice(0, cols - right.length - 1) + ' '.repeat(space) + right + '\n'
  }
  const chunks: Buffer[] = [
    Buffer.from([0x1b, 0x40]), // Initialize
    Buffer.from([0x1b, 0x61, 0x01]), // Center
    Buffer.from(`${settings.store.name || 'Smart POS'}\n`, 'utf8')
  ]
  if (settings.store.address) chunks.push(Buffer.from(`${settings.store.address}\n`, 'utf8'))
  if (settings.store.phone) chunks.push(Buffer.from(`Tel: ${settings.store.phone}\n`, 'utf8'))
  chunks.push(
    Buffer.from([0x1b, 0x61, 0x00]), // Left
    Buffer.from(line('-')),
    Buffer.from(lr('Facture:', sale.invoiceNo)),
    Buffer.from(lr('Date:', new Date(sale.createdAt).toLocaleString('fr-MA'))),
    Buffer.from(lr('Caissier:', sale.userName)),
    Buffer.from(line('-'))
  )
  for (const it of sale.items) {
    chunks.push(Buffer.from(`${it.productName}\n`, 'utf8'))
    chunks.push(Buffer.from(lr(`  ${formatQty(it.qtyMilli)} ${it.unitCode} x ${formatMoney(it.unitPriceCents)}`, formatMoney(it.totalCents))))
  }
  chunks.push(
    Buffer.from(line('-')),
    Buffer.from(lr('TOTAL:', formatMoney(sale.totalCents))),
    Buffer.from(lr('Paye:', formatMoney(sale.paidCents)))
  )
  if (sale.creditCents > 0) chunks.push(Buffer.from(lr('Reste (Credit):', formatMoney(sale.creditCents))))
  chunks.push(
    Buffer.from(line('-')),
    Buffer.from([0x1b, 0x61, 0x01]),
    Buffer.from(`${settings.receipt.footerText}\n\n\n`, 'utf8'),
    Buffer.from([0x1d, 0x56, 0x41, 0x10]) // Partial cut
  )
  if (settings.receipt.openDrawer) {
    chunks.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]))
  }
  return Buffer.concat(chunks)
}

/** Renders arbitrary HTML to a PDF file or prints via Windows driver using an offscreen BrowserWindow. */
export async function renderHtmlToPdfOrPrint(opts: {
  html: string
  action: 'pdf' | 'print'
  pdfPath?: string
  printerName?: string
  copies?: number
  pageSizeMm?: { width: number; height: number }
}): Promise<{ ok: boolean; mode: 'pdf' | 'driver'; filePath?: string; message: string }> {
  const win = new BrowserWindow({
    show: false,
    width: 420,
    height: 640,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(opts.html)}`)
    if (opts.action === 'pdf' && opts.pdfPath) {
      const pdfBuf = await win.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: opts.pageSizeMm
          ? {
              width: Math.max(0.4, Number((opts.pageSizeMm.width / 25.4).toFixed(2))),
              height: Math.max(0.4, Number((opts.pageSizeMm.height / 25.4).toFixed(2)))
            }
          : 'A4'
      })
      writeFileSync(opts.pdfPath, pdfBuf)
      return { ok: true, mode: 'pdf', filePath: opts.pdfPath, message: 'PDF exporté avec succès.' }
    }
    const printers = await win.webContents.getPrintersAsync()
    const target = opts.printerName
      ? printers.find((p) => p.name === opts.printerName)
      : printers.find((p) => (p as { isDefault?: boolean }).isDefault) ?? printers[0]
    if (!target) {
      return {
        ok: false,
        mode: 'driver',
        message: opts.printerName
          ? `Imprimante "${opts.printerName}" introuvable. Utilisez l'export PDF ou sélectionnez une imprimante installée.`
          : 'Aucune imprimante système configurée. Utilisez l’export PDF.'
      }
    }
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: target.name,
          copies: opts.copies ?? 1
        },
        (success, failureReason) => {
          if (!success) reject(new Error(failureReason || 'PRINT_FAILED'))
          else resolve()
        }
      )
    })
    return { ok: true, mode: 'driver', message: `Envoyé à l'imprimante "${target.name}".` }
  } finally {
    win.destroy()
  }
}

export async function sendEscPosNetwork(host: string, port: number, payload: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sock = new Socket()
    sock.setTimeout(4000)
    sock.once('error', (err) => {
      sock.destroy()
      reject(err)
    })
    sock.once('timeout', () => {
      sock.destroy()
      reject(new Error('PRINTER_TIMEOUT'))
    })
    sock.connect(port, host, () => {
      sock.write(payload, (err) => {
        sock.end()
        if (err) reject(err)
        else resolve()
      })
    })
  })
}

export async function sendEscPosSerial(path: string, baudRate: number, payload: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sp = new SerialPort({ path, baudRate, autoOpen: false })
    sp.open((err) => {
      if (err) return reject(err)
      sp.write(payload, (wErr) => {
        sp.close(() => {
          if (wErr) reject(wErr)
          else resolve()
        })
      })
    })
  })
}

export async function listSystemPrinters(): Promise<{ name: string; displayName: string; isDefault: boolean }[]> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return []
  const list = await win.webContents.getPrintersAsync()
  return list.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean((p as { isDefault?: boolean }).isDefault)
  }))
}
