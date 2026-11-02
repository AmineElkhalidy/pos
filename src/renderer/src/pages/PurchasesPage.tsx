import React, { useEffect, useState } from 'react'
import { Plus, CheckCircle2, CreditCard, RotateCcw, Eye, X, Trash2 } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { ErrorBanner } from '../components/ErrorBanner'
import type { ProductRow } from '../../../main/services/products'
import { formatMoney, formatQty, fromCents } from '@shared/money'

interface PurchaseSummary {
  id: number
  reference: string
  supplierId: number | null
  supplierName: string | null
  supplierInvoiceNo: string | null
  status: string
  orderDate: string
  receivedAt: string | null
  totalCents: number
  returnedCents: number
  paidCents: number
  netCents: number
  remainingCents: number
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  itemCount: number
  userName: string
}

interface PurchaseDetail extends PurchaseSummary {
  items: {
    id: number
    productId: number
    productName: string
    unitCode: string
    qtyMilli: number
    unitCostCents: number
    totalCents: number
    expiryDate: string | null
    returnedMilli: number
  }[]
  payments: {
    id: number
    amountCents: number
    method: string
    createdAt: string
    userName: string
    notes: string | null
  }[]
}

export function PurchasesPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)

  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [suppliers, setSuppliers] = useState<Awaited<ReturnType<typeof window.api.listSuppliers>>>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState<PurchaseDetail | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')

  // New purchase form
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10))
  const [receiveNow, setReceiveNow] = useState(true)
  const [initialPay, setInitialPay] = useState('')
  const [lines, setLines] = useState<{ productId: number; qty: string; unitCost: string; expiryDate: string }[]>([])

  const load = async () => {
    try {
      const [pList, sList, prodRes] = await Promise.all([
        window.api.listPurchases(),
        window.api.listSuppliers(),
        window.api.listProducts({ status: 'active', limit: 500 })
      ])
      setPurchases(pList as PurchaseSummary[])
      setSuppliers(sList)
      setProducts(prodRes.items)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openNewPurchase = () => {
    setSupplierId(suppliers[0]?.id ?? null)
    setInvoiceNo('')
    setOrderDate(new Date().toISOString().slice(0, 10))
    setReceiveNow(true)
    setInitialPay('')
    if (products.length > 0) {
      setLines([
        {
          productId: products[0].id,
          qty: '10',
          unitCost: String(fromCents(products[0].purchasePriceCents)),
          expiryDate: ''
        }
      ])
    } else {
      setLines([])
    }
    setShowNew(true)
  }

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await window.api.createPurchase({
        supplierId,
        supplierInvoiceNo: invoiceNo || null,
        orderDate,
        receiveNow,
        items: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitCost: l.unitCost,
          expiryDate: l.expiryDate || null
        })),
        initialPayment:
          Number(initialPay.replace(',', '.')) > 0 ? { amount: initialPay, method: 'CASH' } : null
      })
      setShowNew(false)
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const openDetail = async (id: number) => {
    try {
      const d = (await window.api.getPurchase(id)) as PurchaseDetail
      setDetail(d)
      setPayAmount(String(fromCents(d.remainingCents)))
    } catch (err) {
      notifyError(err)
    }
  }

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return
    try {
      const updated = (await window.api.addPurchasePayment({
        purchaseId: detail.id,
        amount: payAmount,
        method: payMethod
      })) as PurchaseDetail
      setDetail(updated)
      setPayAmount(String(fromCents(updated.remainingCents)))
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">{t.purchases.title}</h2>
        <button
          onClick={openNewPurchase}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          {t.purchases.newPurchase}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-start">Réf.</th>
              <th className="px-4 py-3 text-start">{t.purchases.supplier}</th>
              <th className="px-4 py-3 text-start">{t.purchases.invoiceNo}</th>
              <th className="px-4 py-3 text-start">{t.common.date}</th>
              <th className="px-4 py-3 text-start">{t.common.status}</th>
              <th className="px-4 py-3 text-end">{t.common.total}</th>
              <th className="px-4 py-3 text-end">{t.purchases.paid}</th>
              <th className="px-4 py-3 text-end">{t.purchases.remaining}</th>
              <th className="px-4 py-3 text-end">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {purchases.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  {t.common.noData}
                </td>
              </tr>
            ) : (
              purchases.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-bold text-slate-900">{p.reference}</td>
                  <td className="px-4 py-2.5">{p.supplierName || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{p.supplierInvoiceNo || '—'}</td>
                  <td className="px-4 py-2.5">{p.orderDate}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        p.status === 'received' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end font-bold">{formatMoney(p.netCents, lang)}</td>
                  <td className="px-4 py-2.5 text-end text-emerald-700">{formatMoney(p.paidCents, lang)}</td>
                  <td className="px-4 py-2.5 text-end font-bold text-amber-700">
                    {formatMoney(p.remainingCents, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="inline-flex gap-1.5">
                      {p.status === 'ordered' && (
                        <button
                          onClick={async () => {
                            try {
                              await window.api.receivePurchase(p.id)
                              notify('success', 'Réceptionné en stock.')
                              load()
                            } catch (err) {
                              notifyError(err)
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {t.purchases.receiveBtn}
                        </button>
                      )}
                      <button
                        onClick={() => openDetail(p.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Détails
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Purchase Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">{t.purchases.newPurchase}</h3>
              <button onClick={() => setShowNew(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-3" />
            <form onSubmit={handleCreatePurchase} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold">{t.purchases.supplier}</label>
                  <select
                    value={supplierId ?? ''}
                    onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{t.purchases.invoiceNo}</label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">{t.purchases.orderDate}</label>
                  <input
                    type="date"
                    required
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Articles achetés</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!products.length) return
                      setLines([
                        ...lines,
                        {
                          productId: products[0].id,
                          qty: '1',
                          unitCost: String(fromCents(products[0].purchasePriceCents)),
                          expiryDate: ''
                        }
                      ])
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-1 text-white"
                  >
                    + Ajouter ligne
                  </button>
                </div>
                {lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 items-center gap-2">
                    <select
                      value={l.productId}
                      onChange={(e) => {
                        const pid = Number(e.target.value)
                        const pr = products.find((x) => x.id === pid)
                        const next = [...lines]
                        next[idx] = {
                          ...l,
                          productId: pid,
                          unitCost: pr ? String(fromCents(pr.purchasePriceCents)) : l.unitCost
                        }
                        setLines(next)
                      }}
                      className="col-span-5 rounded border border-slate-300 bg-white px-2 py-1.5 font-semibold"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nameFr} ({p.unitCode})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Qté"
                      value={l.qty}
                      onChange={(e) => {
                        const next = [...lines]
                        next[idx] = { ...l, qty: e.target.value }
                        setLines(next)
                      }}
                      className="col-span-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-end font-bold"
                    />
                    <input
                      type="text"
                      placeholder="Prix achat DH"
                      value={l.unitCost}
                      onChange={(e) => {
                        const next = [...lines]
                        next[idx] = { ...l, unitCost: e.target.value }
                        setLines(next)
                      }}
                      className="col-span-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-end font-bold"
                    />
                    <input
                      type="date"
                      value={l.expiryDate}
                      onChange={(e) => {
                        const next = [...lines]
                        next[idx] = { ...l, expiryDate: e.target.value }
                        setLines(next)
                      }}
                      className="col-span-2 rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                      className="col-span-1 text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={receiveNow}
                    onChange={(e) => setReceiveNow(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  {t.purchases.receiveNow}
                </label>
                <div className="flex items-center gap-2">
                  <label className="font-semibold">Acompte versé (DH, optionnel):</label>
                  <input
                    type="text"
                    value={initialPay}
                    onChange={(e) => setInitialPay(e.target.value)}
                    placeholder="0.00"
                    className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-end font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNew(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 font-semibold"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 font-bold text-white hover:bg-emerald-700"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purchase Detail, Payments & Returns Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl text-xs">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {detail.reference} — {detail.supplierName || 'Fournisseur'}
              </h3>
              <button onClick={() => setDetail(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-3" />

            <table className="mb-4 w-full">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 text-start">Produit</th>
                  <th className="py-2 text-end">Qté</th>
                  <th className="py-2 text-end">Coût unit.</th>
                  <th className="py-2 text-end">Total</th>
                  <th className="py-2 text-end">Retour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 font-semibold">{it.productName}</td>
                    <td className="py-2 text-end">
                      {formatQty(it.qtyMilli)} {it.unitCode}
                    </td>
                    <td className="py-2 text-end">{formatMoney(it.unitCostCents, lang)}</td>
                    <td className="py-2 text-end font-bold">{formatMoney(it.totalCents, lang)}</td>
                    <td className="py-2 text-end">
                      {detail.status === 'received' && it.qtyMilli - it.returnedMilli > 0 && (
                        <button
                          onClick={async () => {
                            const q = prompt(`Quantité à retourner (${it.unitCode}):`, '1')
                            if (!q) return
                            try {
                              const updated = (await window.api.createPurchaseReturn({
                                purchaseId: detail.id,
                                items: [{ purchaseItemId: it.id, qty: q }],
                                reason: 'Retour fournisseur'
                              })) as PurchaseDetail
                              setDetail(updated)
                              load()
                            } catch (err) {
                              notifyError(err)
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Retour
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {detail.remainingCents > 0 && (
              <form onSubmit={handleAddPayment} className="mt-4 flex items-end gap-2 rounded-xl bg-slate-50 p-3">
                <div className="flex-1">
                  <label className="mb-1 block font-semibold">{t.purchases.addPayment} (DH)</label>
                  <input
                    type="text"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Mode</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                  >
                    <option value="CASH">Espèces</option>
                    <option value="CARD">Carte</option>
                    <option value="CHEQUE">Chèque</option>
                    <option value="TRANSFER">Virement</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 font-bold text-white"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  Payer
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

