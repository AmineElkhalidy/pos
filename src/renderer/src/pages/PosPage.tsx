import React, { useEffect, useRef, useState } from 'react'
import {
  Search,
  Scale,
  Trash2,
  Plus,
  Minus,
  Printer,
  CheckCircle2,
  UserPlus,
  History,
  RotateCcw,
  Lock,
  Unlock,
  Percent,
  X,
  CreditCard,
  Banknote,
  Split,
  Package
} from 'lucide-react'
import { useAppStore, useT } from '../store'
import { ErrorBanner } from '../components/ErrorBanner'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import type { ProductRow } from '../../../main/services/products'
import type { CustomerRow } from '../../../main/services/partners'
import type { ScaleReading, ScaleStatus } from '../../../main/services/scale'
import { computeCart, allocatePayments } from '@shared/cart'
import { formatMoney, formatQty, fromCents, toCents, lineAmount } from '@shared/money'
import { compatibleUnits, isMeasuredUnit, toProductMilli, UNITS, type UnitCode } from '@shared/units'

export function PosPage() {
  const { t, lang } = useT()
  const cart = useAppStore((s) => s.cart)
  const cartDiscount = useAppStore((s) => s.cartDiscount)
  const selectedCustomerId = useAppStore((s) => s.selectedCustomerId)
  const addProductToCart = useAppStore((s) => s.addProductToCart)
  const updateCartItemQty = useAppStore((s) => s.updateCartItemQty)
  const updateCartItemDiscount = useAppStore((s) => s.updateCartItemDiscount)
  const removeCartItem = useAppStore((s) => s.removeCartItem)
  const setCartDiscount = useAppStore((s) => s.setCartDiscount)
  const setSelectedCustomerId = useAppStore((s) => s.setSelectedCustomerId)
  const clearCart = useAppStore((s) => s.clearCart)
  const cashSession = useAppStore((s) => s.cashSession)
  const setCashSession = useAppStore((s) => s.setCashSession)
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const setPreviewHtml = useAppStore((s) => s.setPreviewHtml)

  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categories, setCategories] = useState<{ id: number; nameFr: string; nameAr: string | null }[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [paymentMethods, setPaymentMethods] = useState<{ code: string; nameFr: string; nameAr: string; isCash: boolean }[]>([])

  // Payment state
  const [primaryMethod, setPrimaryMethod] = useState('CASH')
  const [tenderedInput, setTenderedInput] = useState('')
  const [splitMode, setSplitMode] = useState(false)
  const [splitPayments, setSplitPayments] = useState<{ method: string; amount: string }[]>([
    { method: 'CASH', amount: '' },
    { method: 'CARD', amount: '' }
  ])

  // Weight / Volume modal state
  const [weightProduct, setWeightProduct] = useState<ProductRow | null>(null)
  const [weightQty, setWeightQty] = useState('350')
  const [weightUnit, setWeightUnit] = useState<UnitCode>('g')
  const [scaleStatus, setScaleStatus] = useState<ScaleStatus | null>(null)
  const [simSliderGrams, setSimSliderGrams] = useState(350)

  // Cash register modal
  const [showCashModal, setShowCashModal] = useState(false)
  const [cashAmountInput, setCashAmountInput] = useState('0')
  const [cashNotesInput, setCashNotesInput] = useState('')

  // Sales history & return modal
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [recentSales, setRecentSales] = useState<Awaited<ReturnType<typeof window.api.listSales>>>([])
  const [returnSaleDetail, setReturnSaleDetail] = useState<Awaited<ReturnType<typeof window.api.getSale>> | null>(null)
  const [returnQtys, setReturnQtys] = useState<Record<number, string>>({})
  const [returnReason, setReturnReason] = useState('')

  // Quick new customer modal
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')

  const loadCatalog = async () => {
    try {
      const [cats, prods, custs, pms, cs, sc] = await Promise.all([
        window.api.listCategories(),
        window.api.listProducts({ status: 'active', limit: 300 }),
        window.api.listCustomers(),
        window.api.listPaymentMethods(),
        window.api.currentCashSession(),
        window.api.getScaleStatus()
      ])
      setCategories(cats.filter((c) => c.active))
      setProducts(prods.items)
      setCustomers(custs)
      setPaymentMethods(pms)
      setCashSession(cs)
      setScaleStatus(sc)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    loadCatalog()
    const unsub = window.api.onScaleReading((r: ScaleReading) => {
      setScaleStatus((prev) => (prev ? { ...prev, lastReading: r } : prev))
    })
    return () => unsub()
  }, [])

  // Handle USB HID barcode scan anywhere on the POS screen
  const handleBarcodeCode = async (rawCode: string) => {
    const code = rawCode.trim()
    if (!code) return
    try {
      const found = await window.api.lookupByCode(code)
      if (!found) {
        notify('error', `${t.pos.unknownBarcode} ${code}`)
        return
      }
      handleSelectProduct(found)
      setQuery('')
    } catch (err) {
      notifyError(err)
    }
  }

  useBarcodeScanner(handleBarcodeCode, true)

  // Keyboard shortcuts: F2 search, F9 complete sale, F10 complete & print, Esc clear cart
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'F9') {
        e.preventDefault()
        handleCompleteSale(false)
      } else if (e.key === 'F10') {
        e.preventDefault()
        handleCompleteSale(true)
      } else if (e.key === 'Escape' && !weightProduct && !showCashModal && !showHistoryModal) {
        if (cart.length > 0 && confirm(lang === 'ar' ? 'إلغاء السلة الحالية؟' : 'Vider le panier en cours ?')) {
          clearCart()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const handleSelectProduct = (product: ProductRow) => {
    if (isMeasuredUnit(product.unitCode) || product.productType === 'weight' || product.productType === 'volume') {
      const defUnit: UnitCode = product.unitCode === 'kg' ? 'g' : product.unitCode === 'L' ? 'ml' : product.unitCode
      setWeightProduct(product)
      setWeightUnit(defUnit)
      setWeightQty(defUnit === 'g' || defUnit === 'ml' ? '250' : '1')
    } else {
      addProductToCart(product, '1', product.unitCode)
    }
  }

  const handleConfirmWeightModal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!weightProduct) return
    const num = Number(weightQty.replace(',', '.'))
    if (!(num > 0)) return
    addProductToCart(weightProduct, weightQty, weightUnit)
    setWeightProduct(null)
  }

  const handleReadFromScale = async () => {
    try {
      const r = await window.api.readScaleWeight()
      if (weightUnit === 'g') {
        setWeightQty(String(r.weightGrams))
      } else if (weightUnit === 'kg') {
        setWeightQty(String(r.weightKg))
      }
    } catch (err) {
      notifyError(err)
    }
  }

  const handleSimSliderChange = async (grams: number) => {
    setSimSliderGrams(grams)
    const r = await window.api.setSimulatedScaleWeight(grams, true)
    if (weightUnit === 'g') setWeightQty(String(r.weightGrams))
    else if (weightUnit === 'kg') setWeightQty(String(r.weightKg))
  }

  // Cart calculation
  const cartCalc = computeCart(
    cart.map((c) => ({
      qtyMilli: c.qtyMilli,
      unitPriceCents: c.unitPriceCents,
      discount: c.discount
    })),
    cartDiscount
  )

  // Payment preview
  const cashCodes = paymentMethods.filter((m) => m.isCash).map((m) => m.code)
  let allocPreview = {
    paidCents: 0,
    creditCents: cartCalc.totalCents,
    tenderedCents: 0,
    changeCents: 0
  }
  try {
    const paymentRows = splitMode
      ? splitPayments
          .filter((sp) => Number(sp.amount.replace(',', '.')) > 0)
          .map((sp) => ({ method: sp.method, amountCents: toCents(sp.amount) }))
      : [
          {
            method: primaryMethod,
            amountCents:
              tenderedInput.trim() === ''
                ? selectedCustomerId
                  ? 0
                  : cartCalc.totalCents
                : toCents(tenderedInput)
          }
        ]
    allocPreview = allocatePayments(
      cartCalc.totalCents,
      paymentRows,
      cashCodes.length ? cashCodes : ['CASH']
    )
  } catch {
    // ignore preview overflow or incomplete input while user edits
  }

  const handleCompleteSale = async (andPrint: boolean) => {
    if (cart.length === 0) return
    try {
      const paymentsPayload = splitMode
        ? splitPayments
            .filter((sp) => Number(sp.amount.replace(',', '.')) > 0)
            .map((sp) => ({ method: sp.method, amount: sp.amount }))
        : [
            {
              method: primaryMethod,
              amount:
                tenderedInput.trim() === ''
                  ? selectedCustomerId
                    ? '0'
                    : String(fromCents(cartCalc.totalCents))
                  : tenderedInput
            }
          ]

      const sale = await window.api.createSale({
        items: cart.map((c) => ({
          productId: c.product.id,
          qty: c.entryQty,
          entryUnit: c.entryUnit,
          unitPrice: fromCents(c.unitPriceCents),
          discount: c.discount
            ? {
                type: c.discount.type,
                value: c.discount.type === 'amount' ? fromCents(c.discount.value) : c.discount.value
              }
            : null
        })),
        cartDiscount: cartDiscount
          ? {
              type: cartDiscount.type,
              value: cartDiscount.type === 'amount' ? fromCents(cartDiscount.value) : cartDiscount.value
            }
          : null,
        customerId: selectedCustomerId,
        payments: paymentsPayload
      })

      clearCart()
      setTenderedInput('')
      setSplitPayments([
        { method: 'CASH', amount: '' },
        { method: 'CARD', amount: '' }
      ])
      notify('success', `${sale.invoiceNo} — ${formatMoney(sale.totalCents, lang)}`)
      loadCatalog()

      if (andPrint) {
        const html = await window.api.getSaleReceiptHtml(sale.id)
        setPreviewHtml({
          title: `Ticket ${sale.invoiceNo}`,
          html,
          onPrint: async () => {
            const res = await window.api.printSaleReceipt(sale.id, 'print')
            notify(res.ok ? 'success' : 'info', res.message)
          },
          onPdf: async () => {
            const res = await window.api.printSaleReceipt(sale.id, 'pdf')
            if (res.ok) notify('success', res.message)
          }
        })
      }
    } catch (err) {
      notifyError(err)
    }
  }

  const handleOpenOrCloseCash = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (!cashSession) {
        const opened = await window.api.openCashSession(cashAmountInput, cashNotesInput || null)
        setCashSession(opened)
        setShowCashModal(false)
        notify('success', lang === 'ar' ? 'تم فتح الصندوق بنجاح' : 'Session de caisse ouverte.')
      } else {
        const closed = await window.api.closeCashSession(cashSession.id, cashAmountInput, cashNotesInput || null)
        setCashSession(null)
        setShowCashModal(false)
        const html = await window.api.getCashSessionReportHtml(closed.id)
        setPreviewHtml({
          title: `Clôture Caisse #${closed.id}`,
          html,
          onPrint: async () => {
            await window.api.printCashSessionReport(closed.id, 'print')
          },
          onPdf: async () => {
            await window.api.printCashSessionReport(closed.id, 'pdf')
          }
        })
      }
    } catch (err) {
      notifyError(err)
    }
  }

  const openHistory = async () => {
    try {
      const list = await window.api.listSales({ limit: 50 })
      setRecentSales(list)
      setReturnSaleDetail(null)
      setShowHistoryModal(true)
    } catch (err) {
      notifyError(err)
    }
  }

  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const id = await window.api.saveCustomer(null, { name: newCustName, phone: newCustPhone, active: true })
      const list = await window.api.listCustomers()
      setCustomers(list)
      setSelectedCustomerId(id)
      setNewCustName('')
      setNewCustPhone('')
      setShowNewCustomer(false)
    } catch (err) {
      notifyError(err)
    }
  }

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!returnSaleDetail) return
    try {
      const items = Object.entries(returnQtys)
        .filter(([, q]) => Number(q.replace(',', '.')) > 0)
        .map(([saleItemId, qty]) => ({ saleItemId: Number(saleItemId), qty }))
      if (!items.length) return
      const res = await window.api.createSaleReturn({
        saleId: returnSaleDetail.id,
        items,
        reason: returnReason || null
      })
      notify('success', `Retour ${res.returnNo} (${formatMoney(res.totalCents, lang)})`)
      setReturnSaleDetail(null)
      setShowHistoryModal(false)
      loadCatalog()
    } catch (err) {
      notifyError(err)
    }
  }

  const filteredProducts = products.filter((p) => {
    if (categoryId && p.categoryId !== categoryId) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      p.nameFr.toLowerCase().includes(q) ||
      (p.nameAr && p.nameAr.includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      p.barcodes.some((b) => b.code.toLowerCase().includes(q))
    )
  })

  // Weight modal live price preview
  let weightPreviewMilli = 0
  try {
    if (weightProduct && Number(weightQty.replace(',', '.')) > 0) {
      weightPreviewMilli = toProductMilli(weightQty, weightUnit, weightProduct.unitCode)
    }
  } catch {
    weightPreviewMilli = 0
  }
  const weightPreviewCents = weightProduct ? lineAmount(weightPreviewMilli, weightProduct.salePriceCents) : 0

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-5 overflow-hidden">
      {/* LEFT: Product Search, Category Pills, and Grid */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {/* Top Search & Action Bar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 p-3.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              data-barcode-input="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  e.preventDefault()
                  handleBarcodeCode(query.trim())
                }
              }}
              placeholder={t.pos.scanPlaceholder}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2 ps-9 pe-3 text-sm focus:border-emerald-600 focus:bg-white focus:outline-none"
            />
          </div>

          <button
            onClick={() => {
              setCashAmountInput(cashSession ? String(fromCents(cashSession.expectedCents)) : '200')
              setCashNotesInput('')
              setShowCashModal(true)
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ${
              cashSession
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
            }`}
          >
            {cashSession ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {cashSession ? `${t.pos.closeRegister} (#${cashSession.id})` : t.pos.openRegister}
          </button>

          <button
            onClick={openHistory}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <History className="h-3.5 w-3.5" />
            {t.pos.recentSalesBtn}
          </button>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50/70 px-3.5 py-2">
          <button
            onClick={() => setCategoryId(null)}
            className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition ${
              categoryId === null ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            {t.common.all}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                categoryId === c.id ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              {lang === 'ar' && c.nameAr ? c.nameAr : c.nameFr}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-3.5">
          {filteredProducts.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">{t.common.noData}</div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((p) => {
                const measured = isMeasuredUnit(p.unitCode)
                const out = p.stockMilli <= 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProduct(p)}
                    className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-start shadow-2xs transition hover:border-emerald-500 hover:shadow-md"
                  >
                    <div>
                      <div className="mb-2 flex items-start gap-2.5">
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.nameFr}
                            className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-400">
                            <Package className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1">
                            <span className="line-clamp-2 text-xs font-bold text-slate-800 group-hover:text-emerald-700">
                              {lang === 'ar' && p.nameAr ? p.nameAr : p.nameFr}
                            </span>
                            {measured && <Scale className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                          </div>
                          {p.nameAr && lang === 'fr' && (
                            <div className="mt-0.5 truncate text-[11px] text-slate-400" dir="rtl">
                              {p.nameAr}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-end justify-between border-t border-slate-100 pt-2">
                      <div>
                        <div className="text-sm font-extrabold text-emerald-700">
                          {formatMoney(p.salePriceCents, lang)}
                        </div>
                        <div className="text-[10px] text-slate-400">/ {p.unitCode}</div>
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          out ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {formatQty(p.stockMilli)} {p.unitCode}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Active Sales Cart & Checkout */}
      <div className="flex w-[440px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {/* Customer Selector Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-1 items-center gap-2">
            <select
              value={selectedCustomerId ?? ''}
              onChange={(e) => setSelectedCustomerId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">{t.pos.walkInCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.balanceCents > 0 ? `(Dette: ${formatMoney(c.balanceCents, lang)})` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewCustomer(true)}
              className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
              title={t.customers.newCustomer}
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-100"
            >
              {t.pos.clearCart}
            </button>
          )}
        </div>

        {/* Cart Lines */}
        <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-4">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-slate-400">
              {t.pos.emptyCart}
            </div>
          ) : (
            cart.map((item, idx) => {
              const lineRes = cartCalc.lines[idx]
              const units = compatibleUnits(item.product.unitCode)
              return (
                <div key={item.key} className="py-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {item.product.image && (
                        <img
                          src={item.product.image}
                          alt={item.product.nameFr}
                          className="h-8 w-8 shrink-0 rounded-md border border-slate-200 object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-slate-800">
                          {lang === 'ar' && item.product.nameAr ? item.product.nameAr : item.product.nameFr}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {formatMoney(item.unitPriceCents, lang)} / {item.product.unitCode}
                        </div>
                      </div>
                    </div>
                    <div className="text-end font-extrabold text-slate-900">
                      {formatMoney(lineRes.totalCents, lang)}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const step = item.entryUnit === 'g' || item.entryUnit === 'ml' ? 50 : 1
                          const next = Math.max(0, Number(item.entryQty.replace(',', '.')) - step)
                          if (next <= 0) removeCartItem(item.key)
                          else updateCartItemQty(item.key, String(next))
                        }}
                        className="rounded border border-slate-200 p-1 hover:bg-slate-100"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="text"
                        value={item.entryQty}
                        onChange={(e) => updateCartItemQty(item.key, e.target.value)}
                        className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-center text-xs font-bold"
                      />
                      {units.length > 1 ? (
                        <select
                          value={item.entryUnit}
                          onChange={(e) => updateCartItemQty(item.key, item.entryQty, e.target.value as UnitCode)}
                          className="rounded border border-slate-300 bg-slate-50 px-1 py-0.5 text-[11px] font-semibold"
                        >
                          {units.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="px-1 text-[11px] text-slate-500">{item.entryUnit}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const step = item.entryUnit === 'g' || item.entryUnit === 'ml' ? 50 : 1
                          const next = Number(item.entryQty.replace(',', '.')) + step
                          updateCartItemQty(item.key, String(next))
                        }}
                        className="rounded border border-slate-200 p-1 hover:bg-slate-100"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const val = prompt(
                            lang === 'ar' ? 'تخفيض السطر بالدرهم (DH):' : 'Remise sur cette ligne (DH) :',
                            item.discount ? String(fromCents(item.discount.value)) : '0'
                          )
                          if (val === null) return
                          try {
                            const cents = toCents(val)
                            updateCartItemDiscount(item.key, cents > 0 ? { type: 'amount', value: cents } : null)
                          } catch (err) {
                            notifyError(err)
                          }
                        }}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          item.discount ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {item.discount ? `-${formatMoney(lineRes.lineDiscountCents, lang)}` : '%'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCartItem(item.key)}
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Totals & Payment Footer */}
        <div className="border-t border-slate-200 bg-slate-50 p-4 text-xs">
          <div className="space-y-1">
            <div className="flex justify-between text-slate-600">
              <span>{t.common.subtotal}</span>
              <span className="font-semibold">{formatMoney(cartCalc.grossCents, lang)}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <button
                type="button"
                onClick={() => {
                  const raw = prompt(
                    lang === 'ar'
                      ? 'تخفيض إجمالي (اكتب مثلاً 10% أو 15 بالدرهم):'
                      : 'Remise globale (ex: 10% ou 15 en DH) :',
                    ''
                  )
                  if (raw === null) return
                  const trimmed = raw.trim()
                  if (!trimmed || trimmed === '0') {
                    setCartDiscount(null)
                    return
                  }
                  try {
                    if (trimmed.endsWith('%')) {
                      const p = Number(trimmed.slice(0, -1).replace(',', '.'))
                      if (p > 0 && p <= 100) setCartDiscount({ type: 'percent', value: p })
                      else throw new Error('INVALID_DISCOUNT')
                    } else {
                      const c = toCents(trimmed)
                      if (c > 0) setCartDiscount({ type: 'amount', value: c })
                      else throw new Error('INVALID_DISCOUNT')
                    }
                  } catch (err) {
                    notifyError(err)
                  }
                }}
                className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
              >
                <Percent className="h-3 w-3" />
                {t.pos.cartDiscount}
              </button>
              <span className="font-semibold text-amber-700">
                -{formatMoney(cartCalc.totalDiscountCents, lang)}
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 text-base font-extrabold text-slate-900">
              <span>{t.common.total}</span>
              <span className="text-xl text-emerald-700">{formatMoney(cartCalc.totalCents, lang)}</span>
            </div>
          </div>

          {/* Payment Methods */}
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">{t.pos.paymentMethod}</span>
              <button
                type="button"
                onClick={() => setSplitMode((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                  splitMode ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                <Split className="h-3 w-3" />
                {t.pos.splitPayment}
              </button>
            </div>

            {!splitMode ? (
              <>
                <div className="grid grid-cols-4 gap-1.5">
                  {paymentMethods.map((pm) => (
                    <button
                      key={pm.code}
                      type="button"
                      onClick={() => setPrimaryMethod(pm.code)}
                      className={`flex items-center justify-center gap-1 rounded-lg border py-1.5 text-[11px] font-bold ${
                        primaryMethod === pm.code
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pm.isCash ? <Banknote className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                      <span className="truncate">{lang === 'ar' ? pm.nameAr : pm.nameFr}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-slate-600">{t.pos.tendered}:</label>
                  <input
                    type="text"
                    value={tenderedInput}
                    onChange={(e) => setTenderedInput(e.target.value)}
                    placeholder={
                      selectedCustomerId
                        ? '0.00 (Crédit total) ou acompte'
                        : fromCents(cartCalc.totalCents).toFixed(2)
                    }
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-end text-xs font-bold focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
                {splitPayments.map((sp, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select
                      value={sp.method}
                      onChange={(e) => {
                        const next = [...splitPayments]
                        next[i] = { ...sp, method: e.target.value }
                        setSplitPayments(next)
                      }}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                    >
                      {paymentMethods.map((m) => (
                        <option key={m.code} value={m.code}>
                          {lang === 'ar' ? m.nameAr : m.nameFr}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="0.00 DH"
                      value={sp.amount}
                      onChange={(e) => {
                        const next = [...splitPayments]
                        next[i] = { ...sp, amount: e.target.value }
                        setSplitPayments(next)
                      }}
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-end text-xs font-bold"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Change due or Credit remaining */}
            {allocPreview.changeCents > 0 && (
              <div className="flex justify-between rounded-lg bg-emerald-100 px-3 py-1.5 font-bold text-emerald-900">
                <span>{t.pos.changeDue}</span>
                <span>{formatMoney(allocPreview.changeCents, lang)}</span>
              </div>
            )}
            {allocPreview.creditCents > 0 && cart.length > 0 && (
              <div className="flex justify-between rounded-lg bg-amber-100 px-3 py-1.5 font-bold text-amber-900">
                <span>{t.pos.remainingCredit}</span>
                <span>{formatMoney(allocPreview.creditCents, lang)}</span>
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => handleCompleteSale(false)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" />
              {t.pos.completeSale}
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => handleCompleteSale(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
            >
              <Printer className="h-4 w-4" />
              {t.pos.completeAndPrint}
            </button>
          </div>
        </div>
      </div>

      {/* Weight / Volume & Live Scale Modal */}
      {weightProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {weightProduct.image && (
                  <img
                    src={weightProduct.image}
                    alt={weightProduct.nameFr}
                    className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 object-cover"
                  />
                )}
                <div>
                  <h3 className="text-base font-bold text-slate-900">{t.pos.weightModalTitle}</h3>
                  <p className="text-xs font-semibold text-emerald-700">
                    {lang === 'ar' && weightProduct.nameAr ? weightProduct.nameAr : weightProduct.nameFr} —{' '}
                    {formatMoney(weightProduct.salePriceCents, lang)} / {weightProduct.unitCode}
                  </p>
                </div>
              </div>
              <button onClick={() => setWeightProduct(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-3" />

            {/* Live Electronic Scale Panel */}
            {(weightProduct.unitCode === 'kg' || weightProduct.unitCode === 'g') && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-900 p-3.5 text-white">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                    <Scale className="h-4 w-4 text-emerald-400" />
                    {t.pos.liveScale}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      scaleStatus?.simulated ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-slate-950'
                    }`}
                  >
                    {scaleStatus?.simulated ? t.pos.simulatedBadge : t.pos.hardwareBadge}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="font-mono text-2xl font-extrabold text-emerald-400">
                    {scaleStatus?.lastReading ? `${scaleStatus.lastReading.weightGrams} g` : '--- g'}
                  </div>
                  <button
                    type="button"
                    onClick={handleReadFromScale}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    {t.pos.readScale}
                  </button>
                </div>
                {scaleStatus?.simulated && (
                  <div className="mt-2.5 border-t border-slate-800 pt-2">
                    <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                      <span>Simulateur de pesée (10 g – 5000 g)</span>
                      <span>{simSliderGrams} g</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={5000}
                      step={5}
                      value={simSliderGrams}
                      onChange={(e) => handleSimSliderChange(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleConfirmWeightModal} className="space-y-4">
              {/* Quick Preset Chips */}
              <div className="flex flex-wrap gap-1.5">
                {UNITS[weightProduct.unitCode].dimension === 'mass'
                  ? [
                      { q: '100', u: 'g' as UnitCode },
                      { q: '125', u: 'g' as UnitCode },
                      { q: '250', u: 'g' as UnitCode },
                      { q: '350', u: 'g' as UnitCode },
                      { q: '500', u: 'g' as UnitCode },
                      { q: '1', u: 'kg' as UnitCode },
                      { q: '1.5', u: 'kg' as UnitCode }
                    ].map((p) => (
                      <button
                        key={`${p.q}${p.u}`}
                        type="button"
                        onClick={() => {
                          setWeightQty(p.q)
                          setWeightUnit(p.u)
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        {p.q} {p.u}
                      </button>
                    ))
                  : [
                      { q: '250', u: 'ml' as UnitCode },
                      { q: '500', u: 'ml' as UnitCode },
                      { q: '750', u: 'ml' as UnitCode },
                      { q: '1', u: 'L' as UnitCode },
                      { q: '2', u: 'L' as UnitCode },
                      { q: '5', u: 'L' as UnitCode }
                    ].map((p) => (
                      <button
                        key={`${p.q}${p.u}`}
                        type="button"
                        onClick={() => {
                          setWeightQty(p.q)
                          setWeightUnit(p.u)
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        {p.q} {p.u}
                      </button>
                    ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  required
                  value={weightQty}
                  onChange={(e) => setWeightQty(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-base font-bold focus:border-emerald-600 focus:outline-none"
                />
                <select
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value as UnitCode)}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold"
                >
                  {compatibleUnits(weightProduct.unitCode).map((u) => (
                    <option key={u} value={u}>
                      {u} ({lang === 'ar' ? UNITS[u].nameAr : UNITS[u].nameFr})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3.5">
                <span className="text-xs font-semibold text-emerald-900">{t.common.total}</span>
                <span className="text-xl font-extrabold text-emerald-700">
                  {formatMoney(weightPreviewCents, lang)}
                </span>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setWeightProduct(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  {t.common.add}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cash Register Open / Close Modal */}
      {showCashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {cashSession ? `${t.pos.closeRegister} #${cashSession.id}` : t.pos.openRegister}
              </h3>
              <button onClick={() => setShowCashModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-3" />
            {cashSession && (
              <div className="mb-4 space-y-1 rounded-xl bg-slate-50 p-3 text-xs">
                <div className="flex justify-between">
                  <span>{t.pos.openingBalance}:</span>
                  <b>{formatMoney(cashSession.openingCents, lang)}</b>
                </div>
                <div className="flex justify-between">
                  <span>+ Ventes espèces:</span>
                  <b>{formatMoney(cashSession.cashSalesCents, lang)}</b>
                </div>
                <div className="flex justify-between">
                  <span>+ Règlements clients (esp.):</span>
                  <b>{formatMoney(cashSession.cashCustomerPaymentsCents, lang)}</b>
                </div>
                <div className="flex justify-between">
                  <span>- Remboursements / Dépenses:</span>
                  <b>-{formatMoney(cashSession.cashRefundsCents + cashSession.cashExpensesCents + cashSession.cashSupplierPaymentsCents, lang)}</b>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-extrabold text-emerald-700">
                  <span>{t.pos.expectedCash}:</span>
                  <span>{formatMoney(cashSession.expectedCents, lang)}</span>
                </div>
              </div>
            )}
            <form onSubmit={handleOpenOrCloseCash} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  {cashSession ? t.pos.countedCash : t.pos.openingBalance} (DH)
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={cashAmountInput}
                  onChange={(e) => setCashAmountInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">{t.common.notes}</label>
                <input
                  type="text"
                  value={cashNotesInput}
                  onChange={(e) => setCashNotesInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCashModal(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  {t.common.confirm}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sales History & Return Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-base font-bold text-slate-900">{t.pos.recentSalesBtn}</h3>
              <button onClick={() => setShowHistoryModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <ErrorBanner className="mb-3" />
              {!returnSaleDetail ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-start text-slate-500">
                      <th className="pb-2 text-start">Facture</th>
                      <th className="pb-2 text-start">{t.common.date}</th>
                      <th className="pb-2 text-start">{t.pos.customer}</th>
                      <th className="pb-2 text-end">{t.common.total}</th>
                      <th className="pb-2 text-end">Crédit</th>
                      <th className="pb-2 text-end">{t.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentSales.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 font-bold">{s.invoiceNo}</td>
                        <td className="py-2.5">{new Date(s.createdAt).toLocaleString('fr-MA')}</td>
                        <td className="py-2.5">{s.customerName || t.pos.walkInCustomer}</td>
                        <td className="py-2.5 text-end font-bold">{formatMoney(s.totalCents, lang)}</td>
                        <td className="py-2.5 text-end text-amber-700">{formatMoney(s.creditCents, lang)}</td>
                        <td className="py-2.5 text-end">
                          <div className="inline-flex gap-1.5">
                            <button
                              onClick={async () => {
                                try {
                                  const html = await window.api.getSaleReceiptHtml(s.id)
                                  setPreviewHtml({
                                    title: `Ticket ${s.invoiceNo}`,
                                    html,
                                    onPrint: async () => {
                                      await window.api.printSaleReceipt(s.id, 'print')
                                    },
                                    onPdf: async () => {
                                      await window.api.printSaleReceipt(s.id, 'pdf')
                                    }
                                  })
                                } catch (err) {
                                  notifyError(err)
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold hover:bg-slate-50"
                            >
                              <Printer className="h-3 w-3" />
                              {t.pos.reprintReceipt}
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  const detail = await window.api.getSale(s.id)
                                  setReturnSaleDetail(detail)
                                  setReturnQtys({})
                                  setReturnReason('')
                                } catch (err) {
                                  notifyError(err)
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {t.pos.returnSale}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <form onSubmit={handleSubmitReturn} className="space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-800">
                      {t.pos.returnSale} — {returnSaleDetail.invoiceNo}
                    </div>
                    <button
                      type="button"
                      onClick={() => setReturnSaleDetail(null)}
                      className="text-emerald-700 hover:underline"
                    >
                      ← Retour à la liste
                    </button>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 text-start">Produit</th>
                        <th className="py-2 text-end">Vendu</th>
                        <th className="py-2 text-end">Déjà retourné</th>
                        <th className="py-2 text-end">Qté à retourner</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {returnSaleDetail.items.map((it) => {
                        const avail = it.qtyMilli - it.returnedMilli
                        return (
                          <tr key={it.id}>
                            <td className="py-2 font-semibold">{it.productName}</td>
                            <td className="py-2 text-end">
                              {formatQty(it.qtyMilli)} {it.unitCode}
                            </td>
                            <td className="py-2 text-end">
                              {formatQty(it.returnedMilli)} {it.unitCode}
                            </td>
                            <td className="py-2 text-end">
                              {avail > 0 ? (
                                <input
                                  type="text"
                                  placeholder={`Max ${formatQty(avail)}`}
                                  value={returnQtys[it.id] ?? ''}
                                  onChange={(e) => setReturnQtys({ ...returnQtys, [it.id]: e.target.value })}
                                  className="w-28 rounded border border-slate-300 px-2 py-1 text-end font-bold"
                                />
                              ) : (
                                <span className="text-slate-400">Complet</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">Motif du retour</label>
                    <input
                      type="text"
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="submit"
                      className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700"
                    >
                      Valider le retour
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick New Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-sm font-bold text-slate-900">{t.customers.newCustomer}</h3>
            <ErrorBanner className="mb-3" />
            <form onSubmit={handleCreateQuickCustomer} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">{t.customers.name} *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.customers.phone}</label>
                <input
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold"
                >
                  {t.common.cancel}
                </button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 font-bold text-white">
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

