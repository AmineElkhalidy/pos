import React, { useEffect, useState } from 'react'
import { Plus, Search, ClipboardCheck, History, Boxes, CheckCircle2, X } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { ErrorBanner } from '../components/ErrorBanner'
import { formatMoney, formatQty, fromMilli } from '@shared/money'

export function StockPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const user = useAppStore((s) => s.user)
  const canManage = user?.role === 'ADMIN' || user?.permissions.includes('stock.manage')

  const [tab, setTab] = useState<'overview' | 'movements' | 'inventory'>('overview')
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'expiring'>('all')
  const [search, setSearch] = useState('')
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof window.api.stockOverview>>>([])
  const [movements, setMovements] = useState<Awaited<ReturnType<typeof window.api.listMovements>>>([])
  const [movTypeFilter, setMovTypeFilter] = useState('')

  // Manual movement modal
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moveProductId, setMoveProductId] = useState<number>(0)
  const [moveType, setMoveType] = useState<'ADJUSTMENT' | 'DAMAGE' | 'EXPIRATION' | 'INITIAL_STOCK' | 'PURCHASE'>('ADJUSTMENT')
  const [moveDir, setMoveDir] = useState<'in' | 'out'>('in')
  const [moveQty, setMoveQty] = useState('1')
  const [moveCost, setMoveCost] = useState('')
  const [moveNote, setMoveNote] = useState('')

  // Inventory counts
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof window.api.listInventoryCounts>>>([])
  const [activeCount, setActiveCount] = useState<Awaited<ReturnType<typeof window.api.getInventoryCount>> | null>(null)

  const load = async () => {
    try {
      if (tab === 'overview') {
        const res = await window.api.stockOverview({ filter, search })
        setOverview(res)
      } else if (tab === 'movements') {
        const res = await window.api.listMovements({ type: movTypeFilter || undefined, search, limit: 500 })
        setMovements(res)
      } else {
        const list = await window.api.listInventoryCounts()
        setCounts(list)
        const open = list.find((c) => c.status === 'open')
        if (open) {
          setActiveCount(await window.api.getInventoryCount(open.id))
        }
      }
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [tab, filter, search, movTypeFilter])

  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await window.api.manualMovement({
        productId: moveProductId,
        type: moveType,
        direction: moveDir,
        qty: moveQty,
        unitCost: moveCost.trim() ? moveCost : undefined,
        note: moveNote || null
      })
      setShowMoveModal(false)
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const handleStartInventory = async () => {
    try {
      const id = await window.api.createInventoryCount({ notes: `Inventaire du ${new Date().toLocaleDateString('fr-MA')}` })
      setActiveCount(await window.api.getInventoryCount(id))
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const handleFinalizeInventory = async () => {
    if (!activeCount) return
    if (!confirm("Confirmer et appliquer les écarts d'inventaire au stock ?")) return
    try {
      const res = await window.api.finalizeInventoryCount(activeCount.id)
      notify('success', `Inventaire clôturé (${res.adjusted} produits ajustés).`)
      setActiveCount(await window.api.getInventoryCount(activeCount.id))
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const totalStockValue = overview.reduce((a, b) => a + b.valueCents, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold shadow-2xs">
          <button
            onClick={() => setTab('overview')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 ${
              tab === 'overview' ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            <Boxes className="h-3.5 w-3.5" />
            {t.stock.overview}
          </button>
          <button
            onClick={() => setTab('movements')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 ${
              tab === 'movements' ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            {t.stock.movements}
          </button>
          <button
            onClick={() => setTab('inventory')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 ${
              tab === 'inventory' ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            {t.stock.inventoryCount}
          </button>
        </div>

        {canManage && tab !== 'inventory' && (
          <button
            onClick={() => {
              if (overview.length > 0 && !moveProductId) setMoveProductId(overview[0].id)
              setMoveQty('1')
              setMoveNote('')
              setShowMoveModal(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            {t.stock.newMovement}
          </button>
        )}
      </div>

      {tab === 'overview' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px]">
                <Search className="pointer-events-none absolute start-3 top-2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.common.search}
                  className="w-full rounded-xl border border-slate-300 py-1.5 ps-9 pe-3 text-xs"
                />
              </div>
              {(['all', 'low', 'out', 'expiring'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    filter === f ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {f === 'all'
                    ? t.common.all
                    : f === 'low'
                      ? t.dashboard.lowStock
                      : f === 'out'
                        ? t.dashboard.outOfStock
                        : t.stock.expiringSoon}
                </button>
              ))}
            </div>
            <div className="text-xs font-bold text-slate-700">
              {t.stock.stockValue}: <span className="text-emerald-700">{formatMoney(totalStockValue, lang)}</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">{t.products.nameFr}</th>
                  <th className="px-4 py-3 text-start">{t.products.category}</th>
                  <th className="px-4 py-3 text-end">{t.products.stock}</th>
                  <th className="px-4 py-3 text-end">{t.products.minStock}</th>
                  <th className="px-4 py-3 text-end">CMUP</th>
                  <th className="px-4 py-3 text-end">{t.stock.stockValue}</th>
                  <th className="px-4 py-3 text-start">{t.products.expiryDate}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-bold text-slate-900">
                      {lang === 'ar' && p.nameAr ? p.nameAr : p.nameFr}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{p.categoryName || '—'}</td>
                    <td className="px-4 py-2.5 text-end">
                      <span
                        className={`rounded-full px-2 py-0.5 font-bold ${
                          p.stockMilli <= 0
                            ? 'bg-red-100 text-red-700'
                            : p.stockMilli <= p.minStockMilli
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {formatQty(p.stockMilli)} {p.unitCode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end text-slate-500">
                      {formatQty(p.minStockMilli)} {p.unitCode}
                    </td>
                    <td className="px-4 py-2.5 text-end">{formatMoney(p.avgCostCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-bold">{formatMoney(p.valueCents, lang)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.expiryDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'movements' && (
        <>
          <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.common.search}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
            />
            <select
              value={movTypeFilter}
              onChange={(e) => setMovTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
            >
              <option value="">{t.stock.movementType}: {t.common.all}</option>
              <option value="SALE">SALE (Vente)</option>
              <option value="PURCHASE">PURCHASE (Achat)</option>
              <option value="SALE_RETURN">SALE_RETURN (Retour client)</option>
              <option value="PURCHASE_RETURN">PURCHASE_RETURN (Retour fournisseur)</option>
              <option value="ADJUSTMENT">ADJUSTMENT (Ajustement)</option>
              <option value="INITIAL_STOCK">INITIAL_STOCK (Stock initial)</option>
              <option value="DAMAGE">DAMAGE (Perte / Casse)</option>
              <option value="EXPIRATION">EXPIRATION (Péremption)</option>
              <option value="INVENTORY">INVENTORY (Inventaire)</option>
            </select>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">{t.common.date}</th>
                  <th className="px-4 py-3 text-start">Produit</th>
                  <th className="px-4 py-3 text-start">Type</th>
                  <th className="px-4 py-3 text-end">Variation</th>
                  <th className="px-4 py-3 text-end">Stock après</th>
                  <th className="px-4 py-3 text-start">Utilisateur / Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 text-slate-500">{new Date(m.createdAt).toLocaleString('fr-MA')}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">{m.productName}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold">{m.type}</span>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-end font-bold ${
                        m.qtyMilli > 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {m.qtyMilli > 0 ? '+' : ''}
                      {formatQty(m.qtyMilli)} {m.unitCode}
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">
                      {formatQty(m.balanceAfterMilli)} {m.unitCode}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {m.userName || 'Système'} {m.note ? `· ${m.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs">
              <div className="font-bold text-slate-900">{t.stock.inventoryCount}</div>
              <div className="text-slate-500">
                Comptez les quantités physiques pour calculer les écarts et ajuster automatiquement le stock.
              </div>
            </div>
            {canManage && (!activeCount || activeCount.status !== 'open') && (
              <button
                onClick={handleStartInventory}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                + {t.stock.startInventory}
              </button>
            )}
            {canManage && activeCount && activeCount.status === 'open' && (
              <button
                onClick={handleFinalizeInventory}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t.stock.finalizeInventory}
              </button>
            )}
          </div>

          {activeCount && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
                <span className="font-bold">
                  Inventaire #{activeCount.id} ({activeCount.status}) — {new Date(activeCount.createdAt).toLocaleString('fr-MA')}
                </span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-2.5 text-start">Produit</th>
                    <th className="px-4 py-2.5 text-end">{t.stock.expectedQty}</th>
                    <th className="px-4 py-2.5 text-end">{t.stock.countedQty}</th>
                    <th className="px-4 py-2.5 text-end">{t.stock.discrepancy}</th>
                    <th className="px-4 py-2.5 text-end">Valeur Écart</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeCount.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-4 py-2 font-bold text-slate-800">{it.nameFr}</td>
                      <td className="px-4 py-2 text-end">
                        {formatQty(it.expectedMilli)} {it.unitCode}
                      </td>
                      <td className="px-4 py-2 text-end">
                        {activeCount.status === 'open' ? (
                          <input
                            type="text"
                            defaultValue={it.countedMilli === null ? '' : String(fromMilli(it.countedMilli))}
                            onBlur={async (e) => {
                              try {
                                await window.api.setCountedQty(it.id, e.target.value)
                                setActiveCount(await window.api.getInventoryCount(activeCount.id))
                              } catch (err) {
                                notifyError(err)
                              }
                            }}
                            placeholder={String(fromMilli(it.expectedMilli))}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-end font-bold"
                          />
                        ) : it.countedMilli === null ? (
                          '—'
                        ) : (
                          `${formatQty(it.countedMilli)} ${it.unitCode}`
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-end font-bold ${
                          !it.differenceMilli
                            ? 'text-slate-400'
                            : it.differenceMilli > 0
                              ? 'text-emerald-700'
                              : 'text-red-600'
                        }`}
                      >
                        {it.differenceMilli === null
                          ? '—'
                          : `${it.differenceMilli > 0 ? '+' : ''}${formatQty(it.differenceMilli)} ${it.unitCode}`}
                      </td>
                      <td className="px-4 py-2 text-end font-semibold">
                        {it.differenceValueCents === null ? '—' : formatMoney(it.differenceValueCents, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {counts.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs">
              <div className="mb-2 font-bold text-slate-700">Historique des inventaires</div>
              <div className="flex flex-wrap gap-2">
                {counts.map((c) => (
                  <button
                    key={c.id}
                    onClick={async () => {
                      try {
                        setActiveCount(await window.api.getInventoryCount(c.id))
                      } catch (err) {
                        notifyError(err)
                      }
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold hover:bg-slate-50"
                  >
                    #{c.id} · {c.status} ({c.countedCount}/{c.itemCount})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Movement Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">{t.stock.newMovement}</h3>
              <button onClick={() => setShowMoveModal(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-3" />
            <form onSubmit={handleSaveMovement} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">Produit *</label>
                <select
                  value={moveProductId}
                  onChange={(e) => setMoveProductId(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                >
                  {overview.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameFr} ({formatQty(p.stockMilli)} {p.unitCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">{t.stock.movementType}</label>
                  <select
                    value={moveType}
                    onChange={(e) => setMoveType(e.target.value as typeof moveType)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                  >
                    <option value="ADJUSTMENT">ADJUSTMENT (Ajustement)</option>
                    <option value="DAMAGE">DAMAGE (Casse / Perte)</option>
                    <option value="EXPIRATION">EXPIRATION (Péremption)</option>
                    <option value="INITIAL_STOCK">INITIAL_STOCK</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Sens</label>
                  <select
                    value={moveDir}
                    disabled={moveType === 'DAMAGE' || moveType === 'EXPIRATION' || moveType === 'INITIAL_STOCK'}
                    onChange={(e) => setMoveDir(e.target.value as 'in' | 'out')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                  >
                    <option value="in">{t.stock.directionIn}</option>
                    <option value="out">{t.stock.directionOut}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">{t.common.quantity} *</label>
                  <input
                    type="text"
                    required
                    value={moveQty}
                    onChange={(e) => setMoveQty(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Coût unitaire (DH, optionnel)</label>
                  <input
                    type="text"
                    value={moveCost}
                    onChange={(e) => setMoveCost(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.common.notes}</label>
                <input
                  type="text"
                  value={moveNote}
                  onChange={(e) => setMoveNote(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMoveModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
                >
                  {t.common.cancel}
                </button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white">
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

