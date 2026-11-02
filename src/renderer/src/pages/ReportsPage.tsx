import { useEffect, useState } from 'react'
import { Download, FileDown } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { formatMoney, formatQty } from '@shared/money'

export function ReportsPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = `${today.slice(0, 8)}01`
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [userId, setUserId] = useState<number | null>(null)
  const [section, setSection] = useState<'products' | 'categories' | 'cashiers' | 'stock' | 'low_stock' | 'debts'>('products')
  const [report, setReport] = useState<Awaited<ReturnType<typeof window.api.getComprehensiveReport>> | null>(null)

  const load = async () => {
    try {
      const res = await window.api.getComprehensiveReport({ from, to, userId })
      setReport(res)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [from, to, userId])

  const setPreset = (days: number) => {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - days)
    setFrom(start.toISOString().slice(0, 10))
    setTo(end.toISOString().slice(0, 10))
  }

  const handleExportCsv = async () => {
    try {
      const res = await window.api.exportReportCsv({ from, to, userId }, section)
      if (res.saved) notify('success', `CSV exporté : ${res.filePath}`)
    } catch (err) {
      notifyError(err)
    }
  }

  const handleExportPdf = async () => {
    if (!report) return
    try {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: Segoe UI, Arial, sans-serif; padding: 20px; font-size: 12px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
        .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 14px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background: #f1f5f9; }
      </style></head><body>
        <h1>Rapport Financier Smart POS (${from} → ${to})</h1>
        <div class="kpis">
          <div class="kpi"><b>CA Net:</b> ${formatMoney(report.summary.netRevenueCents)}</div>
          <div class="kpi"><b>Coût Marchandises (Historique):</b> ${formatMoney(report.summary.netCogsCents)}</div>
          <div class="kpi"><b>Marge Brute:</b> ${formatMoney(report.summary.grossProfitCents)}</div>
          <div class="kpi"><b>Dépenses:</b> ${formatMoney(report.summary.expensesCents)}</div>
          <div class="kpi"><b>Bénéfice Net:</b> ${formatMoney(report.summary.netProfitCents)}</div>
          <div class="kpi"><b>Crédits Clients:</b> ${formatMoney(report.summary.totalCustomerDebtCents)}</div>
        </div>
        <table>
          <thead><tr><th>Produit</th><th>Qté</th><th>CA</th><th>Coût hist.</th><th>Marge Brute</th></tr></thead>
          <tbody>
            ${report.byProduct
              .map(
                (p) =>
                  `<tr><td>${p.nameFr}</td><td>${formatQty(p.qtyMilli)} ${p.unitCode}</td><td>${formatMoney(p.revenueCents)}</td><td>${formatMoney(p.costCents)}</td><td>${formatMoney(p.grossProfitCents)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </body></html>`
      const res = await window.api.exportReportPdf({ from, to, userId }, html)
      if (res.saved) notify('success', `PDF exporté : ${res.filePath}`)
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="space-y-5">
      {/* Filters & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600">{t.reports.from}:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600">{t.reports.to}:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold"
            />
          </div>
          <button
            onClick={() => setPreset(0)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold hover:bg-slate-100"
          >
            Aujourd&apos;hui
          </button>
          <button
            onClick={() => setPreset(6)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold hover:bg-slate-100"
          >
            7 jours
          </button>
          <button
            onClick={() => setPreset(29)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-semibold hover:bg-slate-100"
          >
            30 jours
          </button>
          {report && (
            <select
              value={userId ?? ''}
              onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold"
            >
              <option value="">{t.reports.cashier}: {t.common.all}</option>
              {report.byCashier.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.fullName}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-bold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t.common.exportCsv}
          </button>
          <button
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 font-bold text-white hover:bg-emerald-700"
          >
            <FileDown className="h-3.5 w-3.5" />
            {t.common.exportPdf}
          </button>
        </div>
      </div>

      {/* Financial Summary Cards (Gross Profit vs Net Profit) */}
      {report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">{t.reports.netRevenue}</div>
            <div className="mt-1 text-lg font-extrabold text-slate-900">
              {formatMoney(report.summary.netRevenueCents, lang)}
            </div>
            <div className="text-[11px] text-slate-400">
              {report.summary.salesCount} ventes · Remises: {formatMoney(report.summary.discountCents, lang)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">{t.reports.historicalCogs}</div>
            <div className="mt-1 text-lg font-extrabold text-slate-700">
              {formatMoney(report.summary.netCogsCents, lang)}
            </div>
            <div className="text-[11px] text-slate-400">Achats période: {formatMoney(report.summary.purchasesTotalCents, lang)}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs font-semibold text-emerald-800">{t.reports.grossProfit}</div>
            <div className="mt-1 text-lg font-extrabold text-emerald-700">
              {formatMoney(report.summary.grossProfitCents, lang)}
            </div>
            <div className="text-[11px] text-emerald-700">= CA Net − Coût historique</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">{t.reports.expenses}</div>
            <div className="mt-1 text-lg font-extrabold text-red-600">
              {formatMoney(report.summary.expensesCents, lang)}
            </div>
            <div className="text-[11px] text-slate-400">{report.summary.expensesCount} dépenses</div>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
            <div className="text-xs font-semibold text-sky-900">{t.reports.netProfit}</div>
            <div className="mt-1 text-lg font-extrabold text-sky-800">
              {formatMoney(report.summary.netProfitCents, lang)}
            </div>
            <div className="text-[11px] text-sky-700">= Marge Brute − Dépenses</div>
          </div>
        </div>
      )}

      {/* Report Section Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 text-xs font-bold">
        {(
          [
            { id: 'products', label: t.reports.byProduct },
            { id: 'categories', label: t.reports.byCategory },
            { id: 'cashiers', label: t.reports.byCashier },
            { id: 'stock', label: t.reports.stockValuation },
            { id: 'low_stock', label: t.reports.lowStockReport },
            { id: 'debts', label: t.reports.customerDebtsReport }
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSection(tab.id)}
            className={`rounded-lg px-3 py-1.5 ${
              section === tab.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Report Tables */}
      {report && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {section === 'products' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">Produit</th>
                  <th className="px-4 py-3 text-start">Catégorie</th>
                  <th className="px-4 py-3 text-end">Quantité vendue</th>
                  <th className="px-4 py-3 text-end">CA Net</th>
                  <th className="px-4 py-3 text-end">Coût d&apos;achat (historique)</th>
                  <th className="px-4 py-3 text-end">{t.reports.grossProfit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.byProduct.map((p) => (
                  <tr key={p.productId}>
                    <td className="px-4 py-2.5 font-bold">{p.nameFr}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.categoryName || '—'}</td>
                    <td className="px-4 py-2.5 text-end">
                      {formatQty(p.qtyMilli)} {p.unitCode}
                    </td>
                    <td className="px-4 py-2.5 text-end font-bold">{formatMoney(p.revenueCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end text-slate-600">{formatMoney(p.costCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-bold text-emerald-700">
                      {formatMoney(p.grossProfitCents, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {section === 'categories' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">Catégorie</th>
                  <th className="px-4 py-3 text-end">Ventes</th>
                  <th className="px-4 py-3 text-end">CA Net</th>
                  <th className="px-4 py-3 text-end">Coût</th>
                  <th className="px-4 py-3 text-end">{t.reports.grossProfit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.byCategory.map((c) => (
                  <tr key={c.categoryId}>
                    <td className="px-4 py-2.5 font-bold">{lang === 'ar' ? c.nameAr : c.nameFr}</td>
                    <td className="px-4 py-2.5 text-end">{c.salesCount}</td>
                    <td className="px-4 py-2.5 text-end font-bold">{formatMoney(c.revenueCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end">{formatMoney(c.costCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-bold text-emerald-700">
                      {formatMoney(c.grossProfitCents, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {section === 'cashiers' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">Caissier</th>
                  <th className="px-4 py-3 text-end">Nb ventes</th>
                  <th className="px-4 py-3 text-end">Chiffre d&apos;affaires</th>
                  <th className="px-4 py-3 text-end">Remises accordées</th>
                  <th className="px-4 py-3 text-end">Crédits accordés</th>
                  <th className="px-4 py-3 text-end">{t.reports.grossProfit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.byCashier.map((u) => (
                  <tr key={u.userId}>
                    <td className="px-4 py-2.5 font-bold">{u.fullName}</td>
                    <td className="px-4 py-2.5 text-end">{u.salesCount}</td>
                    <td className="px-4 py-2.5 text-end font-bold">{formatMoney(u.revenueCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end">{formatMoney(u.discountCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end text-amber-700">{formatMoney(u.creditCents, lang)}</td>
                    <td className="px-4 py-2.5 text-end font-bold text-emerald-700">
                      {formatMoney(u.grossProfitCents, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(section === 'stock' || section === 'low_stock') && (
            <div>
              <div className="flex justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold">
                <span>Valeur totale au coût (CMUP): {formatMoney(report.summary.totalStockCostCents, lang)}</span>
                <span>Valeur totale au prix de vente: {formatMoney(report.summary.totalStockRetailCents, lang)}</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-start">Produit</th>
                    <th className="px-4 py-3 text-end">Stock actuel</th>
                    <th className="px-4 py-3 text-end">Seuil min.</th>
                    <th className="px-4 py-3 text-end">CMUP</th>
                    <th className="px-4 py-3 text-end">Valeur coût</th>
                    <th className="px-4 py-3 text-end">Valeur vente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(section === 'low_stock' ? report.lowStock : report.stockValuation).map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 font-bold">{p.nameFr}</td>
                      <td className="px-4 py-2.5 text-end font-bold">
                        {formatQty(p.stockMilli)} {p.unitCode}
                      </td>
                      <td className="px-4 py-2.5 text-end text-slate-500">
                        {formatQty(p.minStockMilli)} {p.unitCode}
                      </td>
                      <td className="px-4 py-2.5 text-end">{formatMoney(p.avgCostCents, lang)}</td>
                      <td className="px-4 py-2.5 text-end font-bold">{formatMoney(p.costValueCents, lang)}</td>
                      <td className="px-4 py-2.5 text-end text-emerald-700">
                        {formatMoney(p.retailValueCents, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section === 'debts' && (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">{t.customers.name}</th>
                  <th className="px-4 py-3 text-start">{t.customers.phone}</th>
                  <th className="px-4 py-3 text-end">{t.customers.creditLimit}</th>
                  <th className="px-4 py-3 text-end">{t.customers.balance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.customerDebts.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-bold">{c.name}</td>
                    <td className="px-4 py-2.5">{c.phone || '—'}</td>
                    <td className="px-4 py-2.5 text-end">
                      {c.creditLimitCents === null ? '—' : formatMoney(c.creditLimitCents, lang)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-extrabold text-amber-700">
                      {formatMoney(c.balanceCents, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
