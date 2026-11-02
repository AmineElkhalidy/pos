import React from 'react'
import { AlertTriangle, CheckCircle2, Info, RotateCcw, X } from 'lucide-react'
import { useAppStore, useT } from '../store'

export function ErrorBanner({
  message,
  onDismiss,
  className = ''
}: {
  message?: string | null
  onDismiss?: () => void
  className?: string
}) {
  const { lang } = useT()
  const lastError = useAppStore((s) => s.lastError)
  const clearError = useAppStore((s) => s.clearError)

  const displayMsg = message !== undefined ? message : lastError?.message
  const handleClose = onDismiss ?? clearError

  if (!displayMsg) return null

  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-900 shadow-2xs ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <div className="font-bold text-red-800">{lang === 'ar' ? 'تنبيه خطأ' : 'Erreur détectée'}</div>
        <div className="mt-0.5 font-medium leading-relaxed text-red-700">{displayMsg}</div>
      </div>
      <button
        type="button"
        onClick={handleClose}
        className="rounded-lg p-1 text-red-500 hover:bg-red-100 hover:text-red-800"
        title={lang === 'ar' ? 'إغلاق' : 'Fermer'}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold text-white shadow-2xl ${
            toast.type === 'success'
              ? 'border-emerald-500 bg-emerald-600'
              : toast.type === 'error'
                ? 'border-red-400 bg-red-600'
                : 'border-slate-700 bg-slate-800'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : toast.type === 'error' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 leading-relaxed">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="rounded p-0.5 opacity-80 hover:bg-white/15 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

interface ErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-900">
          <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-3 text-red-600">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h2 className="text-base font-bold">Une erreur d&apos;affichage est survenue / حدث خطأ في العرض</h2>
            </div>
            <p className="mb-3 text-xs text-slate-600">
              Vos données SQLite sont intactes. Détail technique de l&apos;erreur :
            </p>
            <pre className="mb-4 max-h-40 overflow-auto rounded-xl bg-red-50 p-3 font-mono text-xs text-red-800">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
            >
              <RotateCcw className="h-4 w-4" />
              Réessayer / إعادة المحاولة
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

