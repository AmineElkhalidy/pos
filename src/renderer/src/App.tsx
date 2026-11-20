import { lazy, Suspense, useEffect, useState } from 'react'
import { useAppStore } from './store'
import { Layout } from './components/Layout'
import { AppErrorBoundary, ToastContainer } from './components/ErrorBanner'
import { LoginPage } from './pages/LoginPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const PosPage = lazy(() => import('./pages/PosPage').then((m) => ({ default: m.PosPage })))
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })))
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })))
const StockPage = lazy(() => import('./pages/StockPage').then((m) => ({ default: m.StockPage })))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage').then((m) => ({ default: m.PurchasesPage })))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })))
const CreditsPage = lazy(() => import('./pages/CreditsPage').then((m) => ({ default: m.CreditsPage })))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })))
const BarcodesPage = lazy(() => import('./pages/BarcodesPage').then((m) => ({ default: m.BarcodesPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))

export function App() {
  const user = useAppStore((s) => s.user)
  const section = useAppStore((s) => s.section)
  const setUser = useAppStore((s) => s.setUser)
  const setSettings = useAppStore((s) => s.setSettings)
  const setLang = useAppStore((s) => s.setLang)
  const notifyError = useAppStore((s) => s.notifyError)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    Promise.all([window.api.getSession(), window.api.getSettings()])
      .then(([u, s]) => {
        setSettings(s)
        setLang(u?.language ?? s.general.language)
        setUser(u)
      })
      .catch((err) => notifyError(err))
      .finally(() => setBooting(false))

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      notifyError(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }, [])

  if (booting) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f172a] text-sm font-semibold text-white">
        Smart POS...
      </div>
    )
  }

  return (
    <AppErrorBoundary>
      {!user ? (
        <LoginPage />
      ) : (
        <Layout>
          <Suspense fallback={<div className="p-6 text-xs text-slate-400">...</div>}>
            {section === 'dashboard' && <DashboardPage />}
            {section === 'pos' && <PosPage />}
            {section === 'products' && <ProductsPage />}
            {section === 'categories' && <CategoriesPage />}
            {section === 'stock' && <StockPage />}
            {section === 'purchases' && <PurchasesPage />}
            {section === 'suppliers' && <SuppliersPage />}
            {section === 'customers' && <CustomersPage />}
            {section === 'credits' && <CreditsPage />}
            {section === 'expenses' && <ExpensesPage />}
            {section === 'barcodes' && <BarcodesPage />}
            {section === 'reports' && <ReportsPage />}
            {section === 'users' && <UsersPage />}
            {section === 'settings' && <SettingsPage />}
          </Suspense>
        </Layout>
      )}
      <ToastContainer />
    </AppErrorBoundary>
  )
}
