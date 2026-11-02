import React, { useEffect, useState } from 'react'
import { Plus, Edit3, Trash2 } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { formatMoney } from '@shared/money'

export function SuppliersPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)

  const [suppliers, setSuppliers] = useState<Awaited<ReturnType<typeof window.api.listSuppliers>>>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  const load = async () => {
    try {
      setSuppliers(await window.api.listSuppliers({ includeInactive: true }))
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await window.api.saveSupplier(editId, {
        name,
        phone: phone || null,
        address: address || null,
        email: email || null,
        notes: notes || null,
        active: true
      })
      setEditId(null)
      setName('')
      setPhone('')
      setAddress('')
      setEmail('')
      setNotes('')
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="mb-4 text-sm font-bold text-slate-900">
          {editId ? t.common.edit : t.common.add} — {t.nav.suppliers}
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
          <div>
            <label className="mb-1 block font-semibold">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
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
                  setEmail('')
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

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-2">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-start">{t.customers.name}</th>
              <th className="px-4 py-3 text-start">{t.customers.phone}</th>
              <th className="px-4 py-3 text-start">{t.customers.address}</th>
              <th className="px-4 py-3 text-end">Solde dû</th>
              <th className="px-4 py-3 text-end">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5 font-bold text-slate-900">{s.name}</td>
                <td className="px-4 py-2.5">{s.phone || '—'}</td>
                <td className="px-4 py-2.5">{s.address || '—'}</td>
                <td className="px-4 py-2.5 text-end font-bold text-amber-700">
                  {formatMoney(s.balanceCents, lang)}
                </td>
                <td className="px-4 py-2.5 text-end">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => {
                        setEditId(s.id)
                        setName(s.name)
                        setPhone(s.phone ?? '')
                        setAddress(s.address ?? '')
                        setEmail(s.email ?? '')
                        setNotes(s.notes ?? '')
                      }}
                      className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Supprimer "${s.name}" ?`)) return
                        try {
                          await window.api.deleteSupplier(s.id)
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
  )
}

