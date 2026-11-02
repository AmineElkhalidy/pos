import React, { useEffect, useState } from 'react'
import { Plus, Edit3, Trash2, FileText, X } from 'lucide-react'
import { useAppStore, useT } from '../store'
import type { CustomerRow, StatementEntry } from '../../../main/services/partners'
import { formatMoney, fromCents } from '@shared/money'

export function CustomersPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const user = useAppStore((s) => s.user)

  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [notes, setNotes] = useState('')

  const [statement, setStatement] = useState<{
    customer: CustomerRow
    entries: StatementEntry[]
    closingBalanceCents: number
  } | null>(null)

  const load = async () => {
    try {
      setCustomers(await window.api.listCustomers({ search }))
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [search])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await window.api.saveCustomer(editId, {
        name,
        phone: phone || null,
        address: address || null,
        creditLimit: creditLimit.trim() ? creditLimit : null,
        notes: notes || null,
        active: true
      })
      setEditId(null)
      setName('')
      setPhone('')
      setAddress('')
      setCreditLimit('')
      setNotes('')
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const openStatement = async (customerId: number) => {
    try {
      const st = await window.api.customerStatement(customerId)
      setStatement(st)
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="mb-4 text-sm font-bold text-slate-900">
          {editId ? t.common.edit : t.customers.newCustomer}
        </h3>
        <form onSubmit={handleSave} className="space-y-3 text-xs">
          <div>
            <label className="mb-1 block font-semibold">{t.customers.name} *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block font-semibold">{t.customers.phone}</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block font-semibold">{t.customers.address}</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          {user?.role === 'ADMIN' && (
            <div>
              <label className="mb-1 block font-semibold">{t.customers.creditLimit}</label>
              <input
                type="text"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="Illimité si vide"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block font-semibold">{t.common.notes}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          <div className="flex gap-2">
            {editId && (
              <button
                type="button"
                onClick={() => {
                  setEditId(null)
                  setName('')
                  setPhone('')
                  setAddress('')
                  setCreditLimit('')
                  setNotes('')
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

      <div className="space-y-3 lg:col-span-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.common.search}
            className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-start">{t.customers.name}</th>
                <th className="px-4 py-3 text-start">{t.customers.phone}</th>
                <th className="px-4 py-3 text-end">{t.customers.creditLimit}</th>
                <th className="px-4 py-3 text-end">{t.customers.balance}</th>
                <th className="px-4 py-3 text-end">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-bold text-slate-900">{c.name}</td>
                  <td className="px-4 py-2.5">{c.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-end text-slate-500">
                    {c.creditLimitCents === null ? '—' : formatMoney(c.creditLimitCents, lang)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-end font-bold ${
                      c.balanceCents > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(c.balanceCents, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openStatement(c.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 font-semibold hover:bg-slate-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {t.customers.statement}
                      </button>
                      <button
                        onClick={() => {
                          setEditId(c.id)
                          setName(c.name)
                          setPhone(c.phone ?? '')
                          setAddress(c.address ?? '')
                          setCreditLimit(c.creditLimitCents === null ? '' : String(fromCents(c.creditLimitCents)))
                          setNotes(c.notes ?? '')
                        }}
                        className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Supprimer "${c.name}" ?`)) return
                          try {
                            await window.api.deleteCustomer(c.id)
                            load()
                          } catch (err) {
                            notifyError(err)
                          }
                        }}
                        className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Account Statement Modal */}
      {statement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl text-xs">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {t.customers.statement} — {statement.customer.name}
                </h3>
                <p className="text-slate-500">
                  Solde actuel : <b className="text-amber-700">{formatMoney(statement.closingBalanceCents, lang)}</b>
                </p>
              </div>
              <button onClick={() => setStatement(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <table className="w-full">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 text-start">{t.common.date}</th>
                  <th className="py-2 text-start">Type</th>
                  <th className="py-2 text-start">Réf.</th>
                  <th className="py-2 text-end">Débit (+Dette)</th>
                  <th className="py-2 text-end">Crédit (-Règlement)</th>
                  <th className="py-2 text-end">Solde progressif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statement.entries.map((e, i) => (
                  <tr key={i}>
                    <td className="py-2">{new Date(e.date).toLocaleString('fr-MA')}</td>
                    <td className="py-2 uppercase">{e.type}</td>
                    <td className="py-2 font-bold">{e.reference}</td>
                    <td className="py-2 text-end text-amber-700">
                      {e.debitCents > 0 ? formatMoney(e.debitCents, lang) : '—'}
                    </td>
                    <td className="py-2 text-end text-emerald-700">
                      {e.creditCents > 0 ? formatMoney(e.creditCents, lang) : '—'}
                    </td>
                    <td className="py-2 text-end font-bold">{formatMoney(e.balanceCents, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

