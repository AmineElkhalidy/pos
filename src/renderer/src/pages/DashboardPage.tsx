import React, { useEffect, useState } from 'react'
import {
  TrendingUp,
  ShoppingBag,
  Coins,
  Package,
  AlertTriangle,
  PackageX,
  WalletCards,
  Receipt,
  RefreshCw,
  Eye
} from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { useAppStore, useT } from '../store'
import type { DashboardData } from '../../../main/services/reports'
import { formatMoney, formatQty, fromCents } from '@shared/money'

export function DashboardPage() {
  const { t, lang } = useT()
  const user = useAppStore((s) => s.user)
  const setSection = useAppStore((s) => s.setSection)
  const setPreviewHtml = useAppStore((s) => s.setPreviewHtml)
  const notifyError = useAppStore((s) => s.notifyError)

  const [data, setData] = useState<DashboardData | null>(null)
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [loading, setLoading] = useState(true)

  const canFinancial = user?.role === 'ADMIN' || user?.permissions.includes('dashboard.financial')

  const load = async () => {
    setLoading(true)
    try {
      const d = await window.api.getDashboard()
      setData(d)
    } catch (err) {
      notifyError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handlePreviewSale = async (saleId: number, invoiceNo: string) => {
    try {
      const html = await window.api.getSaleReceiptHtml(saleId)
      setPreviewHtml({
        title: `Ticket ${invoiceNo}`,
        html,
        onPrint: async () => {
          await window.api.printSaleReceipt(saleId, 'print')
        },
        onPdf: async () => {
          await window.api.printSaleReceipt(saleId, 'pdf')
        }
      })
    } catch (err) {
      notifyError(err)
    }
  }

  if (loading && !data) {
    return <div className="p-8 text-sm text-slate-500">{t.common.loading}</div>
  }
  if (!data) return null

  const chartSource =
    period === 'daily' ? data.chartDaily : period === 'weekly' ? data.chartWeekly : data.chartMonthly
  const chartData = chartSource.map((c) => ({
    label: c.label,
    revenue: fromCents(c.revenueCents),
    profit: fromCents(c.profitCents),
    count: c.count
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t.nav.dashboard}</h2>
          <p className="text-xs text-slate-500">{t.appSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSection('pos')}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
          >
            + {t.nav.pos}
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t.common.refresh}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title={t.dashboard.todayRevenue}
          value={formatMoney(data.todayRevenueCents, lang)}
          sub={`${data.todaySalesCount} ${t.dashboard.todaySalesCount.toLowerCase()}`}
          icon={TrendingUp}
          accent="emerald"
        />
        {canFinancial && (
          <KpiCard
            title={t.dashboard.grossProfit}
            value={formatMoney(data.todayGrossProfitCents, lang)}
            sub={`${t.dashboard.netProfit}: ${formatMoney(data.todayNetProfitCents, lang)}`}
            icon={Coins}
            accent="blue"
          />
        )}
        <KpiCard
          title={t.dashboard.customerDebts}
          value={formatMoney(data.totalCustomerDebtCents, lang)}
          sub={`${data.debtorCount} ${t.nav.customers.toLowerCase()}`}
          icon={WalletCards}
          accent="amber"
          onClick={() => setSection('credits')}
        />
        <KpiCard
          title={t.dashboard.todayExpenses}
          value={formatMoney(data.todayExpensesCents, lang)}
          sub={t.nav.expenses}
          icon={Receipt}
          accent="slate"
          onClick={() => setSection('expenses')}
        />
        <KpiCard
          title={t.dashboard.totalProducts}
          value={String(data.totalProducts)}
          sub={t.nav.products}
          icon={Package}
          accent="slate"
          onClick={() => setSection('products')}
        />
        <KpiCard
          title={t.dashboard.lowStock}
          value={String(data.lowStockCount)}
          sub={t.dashboard.lowStockAlerts}
          icon={AlertTriangle}
          accent="amber"
          onClick={() => setSection('stock')}
        />
        <KpiCard
          title={t.dashboard.outOfStock}
          value={String(data.outOfStockCount)}
          sub={t.nav.stock}
          icon={PackageX}
          accent="red"
          onClick={() => setSection('stock')}
        />
        <KpiCard
          title={t.dashboard.todaySalesCount}
          value={String(data.todaySalesCount)}
          sub={t.nav.pos}
          icon={ShoppingBag}
          accent="emerald"
          onClick={() => setSection('pos')}
        />
      </div>

      {/* Revenue & Profit Chart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-800">{t.dashboard.salesChart}</h3>
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              onClick={() => setPeriod('daily')}
              className={`rounded-md px-3 py-1 font-semibold ${
                period === 'daily' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              {t.dashboard.byDay}
            </button>
            <button
              onClick={() => setPeriod('weekly')}
              className={`rounded-md px-3 py-1 font-semibold ${
                period === 'weekly' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              {t.dashboard.byWeek}
            </button>
            <button
              onClick={() => setPeriod('monthly')}
              className={`rounded-md px-3 py-1 font-semibold ${
                period === 'monthly' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              {t.dashboard.byMonth}
            </button>
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(2)} DH`} />
              <Area
                type="monotone"
                dataKey="revenue"
                name={t.dashboard.todayRevenue}
                stroke="#059669"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#revGrad)"
              />
              {canFinancial && (
                <Area
                  type="monotone"
                  dataKey="profit"
                  name={t.dashboard.grossProfit}
                  stroke="#0284c7"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#profGrad)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Tables: Recent Sales, Best Sellers, Low Stock */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Sales */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-1">
          <h3 className="mb-3 text-sm font-bold text-slate-800">{t.dashboard.recentSales}</h3>
          {data.recentSales.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">{t.dashboard.emptySales}</div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.recentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-bold text-slate-800">{s.invoiceNo}</div>
                    <div className="text-[11px] text-slate-500">
                      {s.customerName || t.pos.walkInCustomer} · {new Date(s.createdAt).toLocaleTimeString('fr-MA', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-end">
                      <div className="font-bold text-emerald-700">{formatMoney(s.totalCents, lang)}</div>
                      {s.creditCents > 0 && (
                        <div className="text-[10px] font-semibold text-amber-700">
                          Crédit: {formatMoney(s.creditCents, lang)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handlePreviewSale(s.id, s.invoiceNo)}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                      title={t.common.preview}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Best Sellers */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-1">
          <h3 className="mb-3 text-sm font-bold text-slate-800">{t.dashboard.bestSellers}</h3>
          {data.bestSellers.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">{t.common.noData}</div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.bestSellers.map((p) => (
                <div key={p.productId} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0 flex-1 pe-2">
                    <div className="truncate font-bold text-slate-800">
                      {lang === 'ar' && p.nameAr ? p.nameAr : p.nameFr}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatQty(p.qtyMilli)} {p.unitCode}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-bold text-slate-900">{formatMoney(p.revenueCents, lang)}</div>
                    {canFinancial && (
                      <div className="text-[10px] font-semibold text-emerald-600">
                        +{formatMoney(p.profitCents, lang)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock Alerts */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-1">
          <h3 className="mb-3 text-sm font-bold text-slate-800">{t.dashboard.lowStockAlerts}</h3>
          {data.lowStockItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">{t.common.noData}</div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0 flex-1 pe-2">
                    <div className="truncate font-bold text-slate-800">
                      {lang === 'ar' && item.nameAr ? item.nameAr : item.nameFr}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Seuil: {formatQty(item.minStockMilli)} {item.unitCode}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      item.stockMilli <= 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {formatQty(item.stockMilli)} {item.unitCode}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
  onClick
}: {
  title: string
  value: string
  sub: string
  icon: React.ComponentType<{ className?: string }>
  accent: 'emerald' | 'blue' | 'amber' | 'red' | 'slate'
  onClick?: () => void
}) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    slate: 'bg-slate-100 text-slate-700'
  }
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition ${
        onClick ? 'cursor-pointer hover:border-emerald-400 hover:shadow-md' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">{title}</div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900">{value}</div>
          <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
        </div>
        <div className={`rounded-xl p-2.5 ${colors[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}
