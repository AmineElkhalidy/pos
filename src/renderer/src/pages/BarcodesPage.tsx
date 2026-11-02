import { useEffect, useState } from 'react'
import { Eye, Plus, Trash2, FileDown } from 'lucide-react'
import { useAppStore, useT } from '../store'
import type { ProductRow } from '../../../main/services/products'
import type { LabelSpec } from '../../../main/services/printing'
import { formatMoney } from '@shared/money'

export function BarcodesPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const setPreviewHtml = useAppStore((s) => s.setPreviewHtml)
  const settings = useAppStore((s) => s.settings)

  const [products, setProducts] = useState<ProductRow[]>([])
  const [queue, setQueue] = useState<LabelSpec[]>([])
  const [widthMm, setWidthMm] = useState(settings?.labels.widthMm ?? 50)
  const [heightMm, setHeightMm] = useState(settings?.labels.heightMm ?? 30)
  const [previewPng, setPreviewPng] = useState<string | null>(null)
  const [previewProduct, setPreviewProduct] = useState<ProductRow | null>(null)

  const load = async () => {
    try {
      const res = await window.api.listProducts({ status: 'active', limit: 500 })
      setProducts(res.items)
      if (res.items.length > 0 && !previewProduct) {
        selectForPreview(res.items[0])
      }
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const selectForPreview = async (p: ProductRow) => {
    setPreviewProduct(p)
    const code = p.barcodes[0]?.code
    if (code) {
      try {
        setPreviewPng(await window.api.renderBarcodePng(code))
      } catch {
        setPreviewPng(null)
      }
    } else {
      setPreviewPng(null)
    }
  }

  const handleAssignInternal = async (p: ProductRow, fmt: 'EAN13' | 'CODE128') => {
    try {
      const code = await window.api.addBarcode(p.id, null, fmt)
      notify('success', `Code interne attribué : ${code}`)
      const updated = await window.api.getProduct(p.id)
      await selectForPreview(updated)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const addToQueue = (p: ProductRow) => {
    const code = p.barcodes[0]?.code
    if (!code) {
      notify('error', 'Attribuez d’abord un code-barres à ce produit.')
      return
    }
    const existing = queue.findIndex((q) => q.barcode === code)
    if (existing >= 0) {
      const next = [...queue]
      next[existing] = { ...next[existing], copies: (next[existing].copies ?? 1) + 1 }
      setQueue(next)
      return
    }
    setQueue([
      ...queue,
      {
        productName: p.nameFr,
        productNameAr: p.nameAr,
        sku: p.sku,
        barcode: code,
        priceCents: p.salePriceCents,
        unitCode: p.unitCode,
        copies: 1,
        widthMm,
        heightMm
      }
    ])
  }

  const handlePreviewSheet = async () => {
    if (!queue.length) return
    try {
      const specs = queue.map((q) => ({ ...q, widthMm, heightMm }))
      const html = await window.api.getBarcodeLabelsHtml(specs)
      setPreviewHtml({
        title: t.barcodes.labelQueue,
        html,
        onPrint: async () => {
          const r = await window.api.printBarcodeLabels(specs, 'print')
          notify(r.ok ? 'success' : 'info', r.message)
        },
        onPdf: async () => {
          const r = await window.api.printBarcodeLabels(specs, 'pdf')
          if (r.ok) notify('success', r.message)
        }
      })
    } catch (err) {
      notifyError(err)
    }
  }

  const withoutBarcode = products.filter((p) => p.barcodes.length === 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Products & Internal Barcode Assignment */}
        <div className="space-y-4 lg:col-span-2">
          {withoutBarcode.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs">
              <div className="mb-2 font-bold text-amber-900">
                {t.barcodes.productsWithoutBarcode} ({withoutBarcode.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {withoutBarcode.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-1.5"
                  >
                    <span className="font-bold text-slate-800">{p.nameFr}</span>
                    <button
                      onClick={() => handleAssignInternal(p, 'EAN13')}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"
                    >
                      + EAN-13
                    </button>
                    <button
                      onClick={() => handleAssignInternal(p, 'CODE128')}
                      className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white"
                    >
                      + Code128
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-800">
              Catalogue des produits & codes-barres ({t.products.internalCodeNote})
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2.5 text-start">Produit</th>
                  <th className="px-4 py-2.5 text-start">Code-barres principal</th>
                  <th className="px-4 py-2.5 text-end">{t.common.price}</th>
                  <th className="px-4 py-2.5 text-end">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => selectForPreview(p)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5 font-bold text-slate-900">
                      {p.nameFr} {p.nameAr ? `· ${p.nameAr}` : ''}
                    </td>
                    <td className="px-4 py-2.5 font-mono">
                      {p.barcodes[0]?.code || <span className="text-amber-600">Aucun</span>}
                    </td>
                    <td className="px-4 py-2.5 text-end font-bold text-emerald-700">
                      {formatMoney(p.salePriceCents, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {p.barcodes.length === 0 ? (
                          <button
                            onClick={() => handleAssignInternal(p, 'EAN13')}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white"
                          >
                            Générer EAN-13
                          </button>
                        ) : (
                          <button
                            onClick={() => addToQueue(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-50 px-2.5 py-1 font-bold text-emerald-800 hover:bg-emerald-100"
                          >
                            <Plus className="h-3 w-3" />
                            Étiquette
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Live Label Preview & Print Queue */}
        <div className="space-y-4">
          {previewProduct && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs text-center">
              <div className="mb-2 text-xs font-bold uppercase text-slate-400">{t.common.preview}</div>
              <div className="mx-auto max-w-[240px] rounded-xl border-2 border-dashed border-slate-300 bg-white p-3">
                <div className="truncate text-xs font-bold text-slate-900">
                  {previewProduct.nameFr}
                </div>
                {previewPng ? (
                  <img src={previewPng} alt="barcode" className="mx-auto my-2 max-h-16 object-contain" />
                ) : (
                  <div className="my-4 text-xs text-slate-400">Aucun code-barres</div>
                )}
                <div className="text-sm font-extrabold text-slate-900">
                  {formatMoney(previewProduct.salePriceCents, lang)}
                </div>
              </div>
            </div>
          )}

          {/* Label Print Queue */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs text-xs">
            <h3 className="mb-3 font-bold text-slate-900">{t.barcodes.labelQueue}</h3>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold">Largeur (mm)</label>
                <input
                  type="number"
                  min={20}
                  max={120}
                  value={widthMm}
                  onChange={(e) => setWidthMm(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Hauteur (mm)</label>
                <input
                  type="number"
                  min={15}
                  max={120}
                  value={heightMm}
                  onChange={(e) => setHeightMm(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-bold"
                />
              </div>
            </div>

            {queue.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                Cliquez sur « + Étiquette » sur un produit pour l’ajouter à l’impression.
              </div>
            ) : (
              <div className="space-y-2">
                {queue.map((q, i) => (
                  <div
                    key={q.barcode}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{q.productName}</div>
                      <div className="font-mono text-[10px] text-slate-500">{q.barcode}</div>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={q.copies ?? 1}
                      onChange={(e) => {
                        const next = [...queue]
                        next[i] = { ...q, copies: Math.max(1, Number(e.target.value)) }
                        setQueue(next)
                      }}
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-center font-bold"
                    />
                    <button
                      onClick={() => setQueue(queue.filter((_, idx) => idx !== i))}
                      className="text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                <div className="flex flex-col gap-2 pt-3">
                  <button
                    onClick={handlePreviewSheet}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700"
                  >
                    <Eye className="h-4 w-4" />
                    {t.common.preview} & {t.barcodes.printLabels}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const specs = queue.map((q) => ({ ...q, widthMm, heightMm }))
                        const res = await window.api.printBarcodeLabels(specs, 'pdf')
                        if (res.ok) notify('success', res.message)
                      } catch (err) {
                        notifyError(err)
                      }
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileDown className="h-4 w-4" />
                    {t.common.exportPdf}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
