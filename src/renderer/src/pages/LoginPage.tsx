import React, { useState } from 'react'
import { Store, Globe, Lock, User, Eye, EyeOff } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { ErrorBanner } from '../components/ErrorBanner'

export function LoginPage() {
  const { t, lang } = useT()
  const setUser = useAppStore((s) => s.setUser)
  const setLang = useAppStore((s) => s.setLang)
  const setSettings = useAppStore((s) => s.setSettings)
  const setCashSession = useAppStore((s) => s.setCashSession)
  const notifyError = useAppStore((s) => s.notifyError)

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrorMsg(null)
    setErrorCode(null)
    try {
      const user = await window.api.login(username, password)
      const [settings, cs] = await Promise.all([window.api.getSettings(), window.api.currentCashSession()])
      setSettings(settings)
      setCashSession(cs)
      setUser(user)
    } catch (err) {
      const translated = notifyError(err)
      setErrorMsg(translated)
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : null
      setErrorCode(code)
    } finally {
      setBusy(false)
    }
  }

  const isUsernameError = errorCode === 'USER_NOT_FOUND' || errorCode === 'USER_INACTIVE' || errorCode === 'USERNAME_REQUIRED'
  const isPasswordError =
    errorCode === 'WRONG_PASSWORD' ||
    errorCode === 'INVALID_CREDENTIALS' ||
    errorCode === 'PASSWORD_REQUIRED' ||
    errorCode === 'LOGIN_LOCKED'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f172a] via-slate-900 to-emerald-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md">
              <Store className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{t.appName}</h1>
              <p className="text-xs text-slate-500">{t.auth.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Globe className="h-3.5 w-3.5 text-emerald-600" />
            {lang === 'fr' ? 'العربية' : 'Français'}
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {errorMsg && <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">{t.auth.username}</label>
            <div className="relative">
              <User className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  if (errorMsg) {
                    setErrorMsg(null)
                    setErrorCode(null)
                  }
                }}
                className={`w-full rounded-xl border py-2.5 ps-9 pe-3 text-sm focus:outline-none ${
                  isUsernameError
                    ? 'border-red-500 bg-red-50/40 focus:border-red-600'
                    : 'border-slate-300 focus:border-emerald-600'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">{t.auth.password}</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errorMsg) {
                    setErrorMsg(null)
                    setErrorCode(null)
                  }
                }}
                className={`w-full rounded-xl border py-2.5 ps-9 pe-10 text-sm focus:outline-none ${
                  isPasswordError
                    ? 'border-red-500 bg-red-50/40 focus:border-red-600'
                    : 'border-slate-300 focus:border-emerald-600'
                }`}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute end-2.5 top-2.5 rounded p-0.5 text-slate-400 hover:text-slate-600"
                title={showPassword ? 'Masquer' : 'Afficher'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? t.common.loading : t.auth.signIn}
          </button>
        </form>

        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
          {t.auth.defaultHint}
        </div>
      </div>
    </div>
  )
}

