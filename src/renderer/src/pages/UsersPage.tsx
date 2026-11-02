import React, { useEffect, useState } from 'react'
import { Plus, Edit3, Shield, History } from 'lucide-react'
import { useAppStore, useT } from '../store'

export function UsersPage() {
  const { t } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)

  const [tab, setTab] = useState<'users' | 'permissions' | 'audit'>('users')
  const [users, setUsers] = useState<Awaited<ReturnType<typeof window.api.listUsers>>>([])
  const [rolePerms, setRolePerms] = useState<{ ADMIN: string[]; CASHIER: string[]; all: string[] } | null>(null)
  const [cashierPerms, setCashierPerms] = useState<string[]>([])
  const [auditLogs, setAuditLogs] = useState<Awaited<ReturnType<typeof window.api.listAuditLogs>>>([])

  // Form
  const [editId, setEditId] = useState<number | null>(null)
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'CASHIER'>('CASHIER')
  const [password, setPassword] = useState('')
  const [active, setActive] = useState(true)

  const load = async () => {
    try {
      const [uList, rp, logs] = await Promise.all([
        window.api.listUsers(),
        window.api.getRolePermissions(),
        window.api.listAuditLogs({ limit: 250 })
      ])
      setUsers(uList)
      setRolePerms(rp)
      setCashierPerms(rp.CASHIER)
      setAuditLogs(logs)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await window.api.saveUser(editId, {
        username,
        fullName,
        role,
        active,
        password: password.trim() ? password : undefined
      })
      setEditId(null)
      setUsername('')
      setFullName('')
      setPassword('')
      setRole('CASHIER')
      setActive(true)
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const handleSavePermissions = async () => {
    try {
      await window.api.setCashierPermissions(cashierPerms)
      notify('success', 'Permissions du rôle Caissier enregistrées.')
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold w-fit">
        <button
          onClick={() => setTab('users')}
          className={`rounded-lg px-4 py-2 ${tab === 'users' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
        >
          Utilisateurs
        </button>
        <button
          onClick={() => setTab('permissions')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 ${
            tab === 'permissions' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          {t.users.cashierPermissions}
        </button>
        <button
          onClick={() => setTab('audit')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 ${
            tab === 'audit' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          {t.users.auditLog}
        </button>
      </div>

      {tab === 'users' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="mb-4 text-sm font-bold text-slate-900">
              {editId ? t.common.edit : t.users.newUser}
            </h3>
            <form onSubmit={handleSaveUser} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">{t.auth.username} *</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.users.fullName} *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.users.role}</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'ADMIN' | 'CASHIER')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                >
                  <option value="CASHIER">CASHIER (Caissier)</option>
                  <option value="ADMIN">ADMIN (Administrateur)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold">
                  {t.auth.password} {editId ? '(laisser vide pour conserver)' : '*'}
                </label>
                <input
                  type="password"
                  required={!editId}
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="accent-emerald-600"
                />
                {t.common.active}
              </label>
              <div className="flex gap-2 pt-2">
                {editId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(null)
                      setUsername('')
                      setFullName('')
                      setPassword('')
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                  >
                    {t.common.cancel}
                  </button>
                )}
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-2">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-start">{t.auth.username}</th>
                  <th className="px-4 py-3 text-start">{t.users.fullName}</th>
                  <th className="px-4 py-3 text-start">{t.users.role}</th>
                  <th className="px-4 py-3 text-start">Dernière connexion</th>
                  <th className="px-4 py-3 text-start">{t.common.status}</th>
                  <th className="px-4 py-3 text-end">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5 font-mono font-bold">{u.username}</td>
                    <td className="px-4 py-2.5 font-semibold">{u.fullName}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          u.role === 'ADMIN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('fr-MA') : '—'}
                    </td>
                    <td className="px-4 py-2.5">{u.active ? t.common.active : t.common.inactive}</td>
                    <td className="px-4 py-2.5 text-end">
                      <button
                        onClick={() => {
                          setEditId(u.id)
                          setUsername(u.username)
                          setFullName(u.fullName)
                          setRole(u.role)
                          setActive(u.active)
                          setPassword('')
                        }}
                        className="rounded border border-slate-200 p-1.5 text-slate-600"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'permissions' && rolePerms && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{t.users.cashierPermissions}</h3>
              <p className="text-slate-500">
                Le rôle ADMIN dispose toujours d’un accès intégral. Cochez les droits attribués aux caissiers :
              </p>
            </div>
            <button
              onClick={handleSavePermissions}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
            >
              {t.common.save}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {rolePerms.all
              .filter((p) => !['users.manage', 'settings.manage', 'backup.manage'].includes(p))
              .map((perm) => (
                <label
                  key={perm}
                  className="flex items-center gap-2.5 rounded-xl border border-slate-200 p-3 font-semibold hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={cashierPerms.includes(perm)}
                    onChange={(e) => {
                      if (e.target.checked) setCashierPerms([...cashierPerms, perm])
                      else setCashierPerms(cashierPerms.filter((x) => x !== perm))
                    }}
                    className="accent-emerald-600"
                  />
                  <span className="font-mono">{perm}</span>
                </label>
              ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-start">{t.common.date}</th>
                <th className="px-4 py-3 text-start">Utilisateur</th>
                <th className="px-4 py-3 text-start">Action</th>
                <th className="px-4 py-3 text-start">Entité</th>
                <th className="px-4 py-3 text-start">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2 text-slate-500">{new Date(log.createdAt).toLocaleString('fr-MA')}</td>
                  <td className="px-4 py-2 font-semibold">{log.fullName || log.username || 'Système'}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {log.entity ? `${log.entity}${log.entityId ? ` #${log.entityId}` : ''}` : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-500">{log.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

