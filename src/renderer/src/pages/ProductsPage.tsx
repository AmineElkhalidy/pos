import React, { useEffect, useRef, useState } from 'react'
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  Upload,
  Download,
  Barcode,
  RotateCcw,
  ImagePlus,
  Package,
  X
} from 'lucide-react'
import { useAppStore, useT } from '../store'
import { ErrorBanner } from '../components/ErrorBanner'
import type { ProductRow } from '../../../main/services/products'
import { formatMoney, formatQty, fromCents, fromMilli } from '@shared/money'
import { UNIT_CODES, UNITS, type UnitCode } from '@shared/units'

/** Reads an uploaded image file and resizes it to a compact data URL (max 360x360) for fast offline SQLite storage. */
async function fileToResizedDataUrl(file: File, maxDim = 360): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('INVALID_IMAGE_FILE')
  }
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('INVALID_IMAGE_FILE'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('INVALID_IMAGE_FILE'))
    el.src = rawDataUrl
  })
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return rawDataUrl
  ctx.drawImage(img, 0, 0, w, h)
  const mime = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
  return canvas.toDataURL(mime, 0.85)
}

export function ProductsPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const clearError = useAppStore((s) => s.clearError)
  const user = useAppStore((s) => s.user)
  const canManage = user?.role === 'ADMIN' || user?.permissions.includes('products.manage')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<{ id: number; nameFr: string; nameAr: string | null }[]>([])
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [status, setStatus] = useState<'active' | 'inactive' | 'archived' | 'all'>('active')

  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [showModal, setShowModal] = useState(false)

  // Form state
  const [nameFr, setNameFr] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [sku, setSku] = useState('')
  const [formCatId, setFormCatId] = useState<number | null>(null)
  const [unitCode, setUnitCode] = useState<UnitCode>('pc')
  const [productType, setProductType] = useState<'standard' | 'weight' | 'volume' | 'pack' | 'variable'>('standard')
  const [purchasePrice, setPurchasePrice] = useState('0')
  const [salePrice, setSalePrice] = useState('0')
  const [minSalePrice, setMinSalePrice] = useState('')
  const [initialStock, setInitialStock] = useState('0')
  const [minStock, setMinStock] = useState('5')
  const [trackExpiry, setTrackExpiry] = useState(false)
  const [expiryDate, setExpiryDate] = useState('')
  const [active, setActive] = useState(true)
  const [notes, setNotes] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [barcodes, setBarcodes] = useState<string[]>([])
  const [newBarcodeInput, setNewBarcodeInput] = useState('')

  const load = async () => {
    try {
      const [res, cats] = await Promise.all([
        window.api.listProducts({ search, categoryId, status, limit: 500, withImages: true }),
        window.api.listCategories()
      ])
      setItems(res.items)
      setTotal(res.total)
      setCategories(cats)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [search, categoryId, status])

  const openNew = () => {
    clearError()
    setEditing(null)
    setNameFr('')
    setNameAr('')
    setSku('')
    setFormCatId(categories[0]?.id ?? null)
    setUnitCode('pc')
    setProductType('standard')
    setPurchasePrice('0')
    setSalePrice('0')
    setMinSalePrice('')
    setInitialStock('0')
    setMinStock('5')
    setTrackExpiry(false)
    setExpiryDate('')
    setActive(true)
    setNotes('')
    setImageDataUrl(null)
    setBarcodes([])
    setNewBarcodeInput('')
    setShowModal(true)
  }

  const openEdit = (p: ProductRow) => {
    clearError()
    setEditing(p)
    setNameFr(p.nameFr)
    setNameAr(p.nameAr ?? '')
    setSku(p.sku ?? '')
    setFormCatId(p.categoryId)
    setUnitCode(p.unitCode)
    setProductType(p.productType)
    setPurchasePrice(String(fromCents(p.purchasePriceCents)))
    setSalePrice(String(fromCents(p.salePriceCents)))
    setMinSalePrice(p.minSalePriceCents === null ? '' : String(fromCents(p.minSalePriceCents)))
    setInitialStock(String(fromMilli(p.stockMilli)))
    setMinStock(String(fromMilli(p.minStockMilli)))
    setTrackExpiry(p.trackExpiry)
    setExpiryDate(p.expiryDate ?? '')
    setActive(p.active)
    setNotes(p.notes ?? '')
    setImageDataUrl(p.image ?? null)
    setBarcodes(p.barcodes.map((b) => b.code))
    setNewBarcodeInput('')
    setShowModal(true)
  }

  const handleImageFile = async (file?: File | null) => {
    if (!file) return
    try {
      const dataUrl = await fileToResizedDataUrl(file)
      setImageDataUrl(dataUrl)
    } catch {
      notify('error', t.products.invalidImageFile)
    }
  }

  const handleUnitChange = (u: UnitCode) => {
    setUnitCode(u)
    if (u === 'kg' || u === 'g') setProductType('weight')
    else if (u === 'L' || u === 'ml') setProductType('volume')
    else if (u === 'pack' || u === 'box') setProductType('pack')
    else setProductType('standard')
  }

  const handleGenerateInternalCode = async (fmt: 'EAN13' | 'CODE128') => {
    try {
      const code = await window.api.generateInternalBarcode(fmt)
      if (!barcodes.includes(code)) setBarcodes([...barcodes, code])
    } catch (err) {
      notifyError(err)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const finalBarcodes = [...barcodes]
      if (newBarcodeInput.trim() && !finalBarcodes.includes(newBarcodeInput.trim())) {
        finalBarcodes.push(newBarcodeInput.trim())
      }
      await window.api.saveProduct(editing?.id ?? null, {
        nameFr,
        nameAr: nameAr || null,
        sku: sku || null,
        categoryId: formCatId,
        unitCode,
        productType,
        purchasePrice,
        salePrice,
        minSalePrice: minSalePrice.trim() ? minSalePrice : null,
        initialStock: editing ? undefined : initialStock,
        minStock,
        trackExpiry,
        expiryDate: trackExpiry && expiryDate ? expiryDate : null,
        active,
        notes: notes || null,
        image: imageDataUrl || null,
        barcodes: finalBarcodes.map((code, i) => ({ code, isPrimary: i === 0 }))
      })
      setShowModal(false)
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const handleDelete = async (p: ProductRow) => {
    if (!confirm(`Supprimer / archiver "${p.nameFr}" ?`)) return
    try {
      const res = await window.api.deleteProduct(p.id)
      notify('info', res === 'archived' ? 'Produit archivé (historique conservé).' : 'Produit supprimé.')
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const handleExportCsv = async () => {
    try {
      const res = await window.api.exportProductsCsv()
      if (res.saved) notify('success', `CSV exporté : ${res.filePath}`)
    } catch (err) {
      notifyError(err)
    }
  }

  const handleImportCsv = async () => {
    try {
      const res = await window.api.importProductsCsv()
      if (!res) return
      notify('success', `Import CSV : ${res.created} créés, ${res.updated} mis à jour, ${res.skipped} ignorés.`)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{t.products.title}</h2>
          <p className="text-xs text-slate-500">{total} articles</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t.common.exportCsv}
          </button>
          {canManage && (
            <>
              <button
                onClick={handleImportCsv}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {t.common.importCsv}
              </button>
              <button
                onClick={openNew}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                {t.products.newProduct}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.common.search}
            className="w-full rounded-xl border border-slate-300 py-1.5 ps-9 pe-3 text-xs focus:border-emerald-600 focus:outline-none"
          />
        </div>
        <select
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
        >
          <option value="">{t.products.category}: {t.common.all}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {lang === 'ar' && c.nameAr ? c.nameAr : c.nameFr}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
        >
          <option value="active">{t.common.active}</option>
          <option value="inactive">{t.common.inactive}</option>
          <option value="archived">{t.common.archived}</option>
          <option value="all">{t.common.all}</option>
        </select>
      </div>

      {/* Products Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-start">{t.products.nameFr}</th>
              <th className="px-4 py-3 text-start">{t.products.category}</th>
              <th className="px-4 py-3 text-start">{t.products.barcodes}</th>
              <th className="px-4 py-3 text-end">{t.products.purchasePrice}</th>
              <th className="px-4 py-3 text-end">{t.products.salePrice}</th>
              <th className="px-4 py-3 text-end">{t.products.stock}</th>
              <th className="px-4 py-3 text-end">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  {t.common.noData}
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt={p.nameFr}
                          className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white object-cover shadow-2xs"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400">
                          <Package className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-900">{p.nameFr}</div>
                        {p.nameAr && <div className="truncate text-[11px] text-slate-500">{p.nameAr}</div>}
                        {p.sku && <div className="font-mono text-[10px] text-slate-400">SKU: {p.sku}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {lang === 'ar' && p.categoryNameAr ? p.categoryNameAr : p.categoryName || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.barcodes.map((b) => (
                        <span
                          key={b.id}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            b.isInternal ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {b.code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-end text-slate-600">
                    {formatMoney(p.purchasePriceCents, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end font-bold text-emerald-700">
                    {formatMoney(p.salePriceCents, lang)} <span className="text-[10px] text-slate-400">/ {p.unitCode}</span>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <span
                      className={`rounded-full px-2 py-0.5 font-bold ${
                        p.stockMilli <= 0
                          ? 'bg-red-100 text-red-700'
                          : p.stockMilli <= p.minStockMilli
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {formatQty(p.stockMilli)} {p.unitCode}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    {canManage && (
                      <div className="inline-flex gap-1">
                        {p.archived ? (
                          <button
                            onClick={async () => {
                              try {
                                await window.api.restoreProduct(p.id)
                                notify('success', 'Produit restauré.')
                                load()
                              } catch (err) {
                                notifyError(err)
                              }
                            }}
                            className="rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700"
                            title="Restaurer"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => openEdit(p)}
                              className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Product Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editing ? t.products.editProduct : t.products.newProduct}
              </h3>
              <button
                onClick={() => {
                  clearError()
                  setShowModal(false)
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-4" />
            <form onSubmit={handleSave} className="space-y-4 text-xs">
              {/* Product Image Upload & Preview */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragActive(false)
                  handleImageFile(e.dataTransfer.files?.[0])
                }}
                className={`flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed p-3.5 transition ${
                  dragActive ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    handleImageFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                {imageDataUrl ? (
                  <img
                    src={imageDataUrl}
                    alt="Aperçu produit"
                    className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-white object-cover shadow-xs"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white text-slate-400 hover:border-emerald-500 hover:text-emerald-600"
                  >
                    <ImagePlus className="h-6 w-6" />
                  </button>
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="font-bold text-slate-800">{t.products.image}</div>
                  <p className="text-[11px] text-slate-500">{t.products.imageHint}</p>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <ImagePlus className="h-3.5 w-3.5 text-emerald-600" />
                      {imageDataUrl ? t.products.changeImage : t.products.chooseImage}
                    </button>
                    {imageDataUrl && (
                      <button
                        type="button"
                        onClick={() => setImageDataUrl(null)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t.products.removeImage}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.nameFr} *</label>
                  <input
                    type="text"
                    required
                    value={nameFr}
                    onChange={(e) => setNameFr(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.nameAr}</label>
                  <input
                    type="text"
                    dir="rtl"
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                    placeholder="مثال: زيت الزيتون"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.sku}</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.category}</label>
                  <select
                    value={formCatId ?? ''}
                    onChange={(e) => setFormCatId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameFr} {c.nameAr ? `(${c.nameAr})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.unit} *</label>
                  <select
                    value={unitCode}
                    onChange={(e) => handleUnitChange(e.target.value as UnitCode)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                  >
                    {UNIT_CODES.map((u) => (
                      <option key={u} value={u}>
                        {u} — {UNITS[u].nameFr} ({UNITS[u].nameAr})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.type}</label>
                  <select
                    value={productType}
                    onChange={(e) => setProductType(e.target.value as typeof productType)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="standard">{t.products.types.standard}</option>
                    <option value="weight">{t.products.types.weight}</option>
                    <option value="volume">{t.products.types.volume}</option>
                    <option value="pack">{t.products.types.pack}</option>
                    <option value="variable">{t.products.types.variable}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.purchasePrice} *</label>
                  <input
                    type="text"
                    required
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.salePrice} *</label>
                  <input
                    type="text"
                    required
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">{t.products.minSalePrice}</label>
                  <input
                    type="text"
                    value={minSalePrice}
                    onChange={(e) => setMinSalePrice(e.target.value)}
                    placeholder="Optionnel"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                {!editing && (
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">
                      {t.products.initialStock} ({unitCode})
                    </label>
                    <input
                      type="text"
                      value={initialStock}
                      onChange={(e) => setInitialStock(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    {t.products.minStock} ({unitCode})
                  </label>
                  <input
                    type="text"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              {/* Barcodes management */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="font-bold text-slate-800">{t.products.barcodes}</label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleGenerateInternalCode('EAN13')}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                    >
                      <Barcode className="h-3.5 w-3.5" />
                      + {t.products.generateEan13}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGenerateInternalCode('CODE128')}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-700"
                    >
                      + {t.products.generateCode128}
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">{t.products.internalCodeNote}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    data-barcode-input="true"
                    value={newBarcodeInput}
                    onChange={(e) => setNewBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newBarcodeInput.trim()) {
                        e.preventDefault()
                        if (!barcodes.includes(newBarcodeInput.trim())) {
                          setBarcodes([...barcodes, newBarcodeInput.trim()])
                        }
                        setNewBarcodeInput('')
                      }
                    }}
                    placeholder="Scanner ou saisir un code-barres puis Entrée"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newBarcodeInput.trim() && !barcodes.includes(newBarcodeInput.trim())) {
                        setBarcodes([...barcodes, newBarcodeInput.trim()])
                        setNewBarcodeInput('')
                      }
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                  >
                    {t.common.add}
                  </button>
                </div>
                {barcodes.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {barcodes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs font-semibold"
                      >
                        {code}
                        <button
                          type="button"
                          onClick={() => setBarcodes(barcodes.filter((c) => c !== code))}
                          className="text-red-500 hover:text-red-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Expiration & Active */}
              <div className="flex flex-wrap items-center gap-6">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={trackExpiry}
                    onChange={(e) => setTrackExpiry(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  {t.products.trackExpiry}
                </label>
                {trackExpiry && (
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                )}
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  {t.common.active}
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700"
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
    </div>
  )
}

