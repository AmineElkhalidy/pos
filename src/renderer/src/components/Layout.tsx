import React, { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Tags,
  Boxes,
  Truck,
  Building2,
  Users,
  WalletCards,
  Receipt,
  Barcode,
  BarChart3,
  ShieldCheck,
  Settings,
  Globe,
  Bell,
  LogOut,
  KeyRound,
  Printer,
  FileDown,
  X,
  Store
} from 'lucide-react'
import { useAppStore, useT, type NavSection } from '../store'
import { ErrorBanner } from './ErrorBanner'
import type { Permission } from '@shared/permissions'

interface NavItem {
  id: NavSection
  icon: React.ComponentType<{ className?: string }>
  perm?: Permission
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
  { id: 'pos', icon: ShoppingCart, perm: 'pos.sell' },
  { id: 'products', icon: Package, perm: 'products.view' },
  { id: 'categories', icon: Tags, perm: 'products.view' },
  { id: 'stock', icon: Boxes, perm: 'stock.view' },
  { id: 'purchases', icon: Truck, perm: 'purchases.manage' },
  { id: 'suppliers', icon: Building2, perm: 'suppliers.manage' },
  { id: 'customers', icon: Users, perm: 'customers.view' },
  { id: 'credits', icon: WalletCards, perm: 'credits.view' },
  { id: 'expenses', icon: Receipt, perm: 'expenses.view' },
  { id: 'barcodes', icon: Barcode, perm: 'barcodes.manage' },
  { id: 'reports', icon: BarChart3, perm: 'reports.view' },
  { id: 'users', icon: ShieldCheck, perm: 'users.manage' },
  { id: 'settings', icon: Settings, perm: 'settings.manage' }
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { t, lang } = useT()
  const user = useAppStore((s) => s.user)
  const section = useAppStore((s) => s.section)
  const setSection = useAppStore((s) => s.setSection)
  const setLang = useAppStore((s) => s.setLang)
  const setUser = useAppStore((s) => s.setUser)
  const settings = useAppStore((s) => s.settings)
  const cashSession = useAppStore((s) => s.cashSession)
  const previewHtml = useAppStore((s) => s.previewHtml)
  const setPreviewHtml = useAppStore((s) => s.setPreviewHtml)
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const clearError = useAppStore((s) => s.clearError)

  const [now, setNow] = useState(new Date())
  const [showPwModal, setShowPwModal] = useState(false)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [showNotif, setShowNotif] = useState(false)
  const [alerts, setAlerts] = useState<{ low: number; out: number; exp: number }>({ low: 0, out: 0, exp: 0 })

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (user?.mustChangePassword) setShowPwModal(true)
  }, [user?.mustChangePassword])

  useEffect(() => {
    if (!user) return
    window.api
      .getDashboard()
      .then((d) => setAlerts({ low: d.lowStockCount, out: d.outOfStockCount, exp: d.expiringCount }))
      .catch(() => undefined)
  }, [user, section])

  const canAccess = (perm?: Permission) => {
    if (!user) return false
    if (!perm || user.role === 'ADMIN') return true
    return user.permissions.includes(perm)
  }

  const handleToggleLanguage = async () => {
    const next = lang === 'fr' ? 'ar' : 'fr'
    setLang(next)
    await window.api.setLanguage(next).catch(() => undefined)
  }

  const handleLogout = async () => {
    await window.api.logout()
    setUser(null)
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await window.api.changeOwnPassword(curPw, newPw)
      const refreshed = await window.api.getSession()
      setUser(refreshed)
      setShowPwModal(false)
      setCurPw('')
      setNewPw('')
      notify('success', lang === 'ar' ? 'تم تحديث كلمة المرور بنجاح' : 'Mot de passe modifié avec succès.')
    } catch (err) {
      notifyError(err)
    }
  }

  const totalAlerts = alerts.low + alerts.out + alerts.exp

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900">
      {/* Persistent Navy Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col bg-[#0f172a] text-slate-200 shadow-xl">
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow">
            <Store className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold tracking-tight text-white">
              {settings?.store.name || t.appName}
            </div>
            <div className="truncate text-xs text-slate-400">{t.appSubtitle}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
          {NAV_ITEMS.filter((item) => canAccess(item.perm)).map((item) => {
            const Icon = item.icon
            const active = section === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t.nav[item.id]}</span>
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-800 p-3 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <span>Smart POS v1.0.0</span>
            <span className="rounded bg-emerald-950 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              Offline SQLite
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Navigation Bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-xs">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-slate-800">{t.nav[section]}</h1>
            {cashSession ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {t.pos.cashSession} #{cashSession.id}
              </span>
            ) : (
              <button
                onClick={() => setSection('pos')}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/20 hover:bg-amber-100"
              >
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                {t.pos.openRegister}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Date & Time */}
            <div className="hidden rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 md:block">
              {now.toLocaleDateString(lang === 'ar' ? 'ar-MA' : 'fr-MA', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              })}{' '}
              · {now.toLocaleTimeString('fr-MA', { hour: '2-digit', minute: '2-digit' })}
            </div>

            {/* Language Switcher */}
            <button
              onClick={handleToggleLanguage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Français / العربية"
            >
              <Globe className="h-4 w-4 text-emerald-600" />
              <span>{lang === 'fr' ? 'العربية' : 'Français'}</span>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotif((v) => !v)}
                className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              >
                <Bell className="h-4 w-4" />
                {totalAlerts > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {totalAlerts}
                  </span>
                )}
              </button>
              {showNotif && (
                <div className="absolute end-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="mb-2 text-xs font-bold uppercase text-slate-500">{t.dashboard.lowStockAlerts}</div>
                  <div className="space-y-1.5 text-xs">
                    <button
                      onClick={() => {
                        setSection('stock')
                        setShowNotif(false)
                      }}
                      className="flex w-full items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-red-800 hover:bg-red-100"
                    >
                      <span>{t.dashboard.outOfStock}</span>
                      <span className="font-bold">{alerts.out}</span>
                    </button>
                    <button
                      onClick={() => {
                        setSection('stock')
                        setShowNotif(false)
                      }}
                      className="flex w-full items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-amber-800 hover:bg-amber-100"
                    >
                      <span>{t.dashboard.lowStock}</span>
                      <span className="font-bold">{alerts.low}</span>
                    </button>
                    <button
                      onClick={() => {
                        setSection('stock')
                        setShowNotif(false)
                      }}
                      className="flex w-full items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-blue-800 hover:bg-blue-100"
                    >
                      <span>{t.stock.expiringSoon}</span>
                      <span className="font-bold">{alerts.exp}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Settings */}
            {canAccess('settings.manage') && (
              <button
                onClick={() => setSection('settings')}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                title={t.nav.settings}
              >
                <Settings className="h-4 w-4" />
              </button>
            )}

            {/* User Profile + Password + Logout */}
            <div className="flex items-center gap-2 border-s border-slate-200 ps-3">
              <div className="text-end">
                <div className="text-xs font-bold text-slate-800">{user?.fullName}</div>
                <div className="text-[11px] font-medium text-emerald-700">{user?.role}</div>
              </div>
              <button
                onClick={() => setShowPwModal(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                title={t.auth.changePassword}
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700 hover:bg-red-100"
                title={t.auth.signOut}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Security Banner if initial password hasn't been changed yet */}
        {user?.mustChangePassword && (
          <div className="flex items-center justify-between bg-amber-500 px-6 py-2 text-xs font-semibold text-slate-950">
            <span>{t.auth.mustChangeNotice}</span>
            <button
              onClick={() => setShowPwModal(true)}
              className="rounded bg-slate-900 px-3 py-1 text-white hover:bg-slate-800"
            >
              {t.auth.changePassword}
            </button>
          </div>
        )}

        {/* Active Module Workspace */}
        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBanner className="mb-4" />
          {children}
        </main>
      </div>

      {/* Password Change Modal */}
      {showPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">{t.auth.changePassword}</h3>
              <button
                onClick={() => {
                  clearError()
                  setShowPwModal(false)
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {user?.mustChangePassword && (
              <div className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{t.auth.mustChangeNotice}</div>
            )}
            <ErrorBanner className="mb-3" />
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">{t.auth.currentPassword}</label>
                <input
                  type="password"
                  required
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">{t.auth.newPassword}</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPwModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Receipt / Document Preview Modal */}
      {previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-bold text-slate-900">{previewHtml.title}</h3>
              <button onClick={() => setPreviewHtml(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
              <iframe
                title="preview"
                srcDoc={previewHtml.html}
                className="mx-auto min-h-[420px] w-full rounded-lg border border-slate-300 bg-white shadow-inner"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              {previewHtml.onPdf && (
                <button
                  onClick={() => previewHtml.onPdf?.().catch((err) => notifyError(err))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileDown className="h-4 w-4" />
                  {t.common.exportPdf}
                </button>
              )}
              {previewHtml.onPrint && (
                <button
                  onClick={() => previewHtml.onPrint?.().catch((err) => notifyError(err))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <Printer className="h-4 w-4" />
                  {t.common.print}
                </button>
              )}
              <button
                onClick={() => setPreviewHtml(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

