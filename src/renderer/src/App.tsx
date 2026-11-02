import { useEffect, useState } from 'react'
import { useAppStore } from './store'
import { Layout } from './components/Layout'
import { AppErrorBoundary, ToastContainer } from './components/ErrorBanner'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { PosPage } from './pages/PosPage'
import { ProductsPage } from './pages/ProductsPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { StockPage } from './pages/StockPage'
import { PurchasesPage } from './pages/PurchasesPage'
import { SuppliersPage } from './pages/SuppliersPage'
import { CustomersPage } from './pages/CustomersPage'
import { CreditsPage } from './pages/CreditsPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { BarcodesPage } from './pages/BarcodesPage'
import { ReportsPage } from './pages/ReportsPage'
import { UsersPage } from './pages/UsersPage'
import { SettingsPage } from './pages/SettingsPage'

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
        </Layout>
      )}
      <ToastContainer />
    </AppErrorBoundary>
  )
}
