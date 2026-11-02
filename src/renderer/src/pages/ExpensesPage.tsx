import React, { useEffect, useState } from 'react'
import { Plus, Trash2, Edit3 } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { formatMoney, fromCents } from '@shared/money'

export function ExpensesPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)

  const [categories, setCategories] = useState<Awaited<ReturnType<typeof window.api.listExpenseCategories>>>([])
  const [data, setData] = useState<Awaited<ReturnType<typeof window.api.listExpenses>> | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<number>(1)
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('CASH')
  const [notes, setNotes] = useState('')

  const load = async () => {
    try {
      const [cats, list] = await Promise.all([window.api.listExpenseCategories(), window.api.listExpenses()])
      setCategories(cats)
      setData(list)
      if (cats.length && !categoryId) setCategoryId(cats[0].id)
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
      await window.api.saveExpense(editId, {
        description,
        categoryId,
        amount,
        expenseDate,
        method,
        notes: notes || null
      })
      setEditId(null)
      setDescription('')
      setAmount('')
      setNotes('')
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="mb-4 text-sm font-bold text-slate-900">
            {editId ? t.common.edit : t.expenses.newExpense}
          </h3>
          <form onSubmit={handleSave} className="space-y-3 text-xs">
            <div>
              <label className="mb-1 block font-semibold">{t.expenses.description} *</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold">{t.expenses.category}</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {lang === 'ar' ? c.nameAr : c.nameFr}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold">{t.common.amount} (DH) *</label>
                <input
                  type="text"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.common.date}</label>
                <input
                  type="date"
                  required
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block font-semibold">{t.pos.paymentMethod}</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-semibold"
              >
                <option value="CASH">Espèces / نقدا</option>
                <option value="CARD">Carte bancaire</option>
                <option value="CHEQUE">Chèque</option>
                <option value="TRANSFER">Virement</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold">{t.common.notes}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.common.save}
            </button>
          </form>
        </div>

        {/* Monthly Summary Card */}
        {data && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs text-xs">
            <h4 className="mb-3 font-bold text-slate-800">{t.expenses.monthlySummary}</h4>
            <div className="space-y-1.5">
              {data.byMonth.map((m) => (
                <div key={m.month} className="flex justify-between border-b border-slate-100 pb-1">
                  <span className="font-semibold text-slate-600">{m.month}</span>
                  <span className="font-bold text-slate-900">{formatMoney(m.totalCents, lang)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-2">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs">
          <span className="font-bold text-slate-800">{t.expenses.title}</span>
          {data && (
            <span className="font-extrabold text-red-600">
              {t.common.total}: {formatMoney(data.totalCents, lang)}
            </span>
          )}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-start">{t.common.date}</th>
              <th className="px-4 py-3 text-start">{t.expenses.description}</th>
              <th className="px-4 py-3 text-start">{t.expenses.category}</th>
              <th className="px-4 py-3 text-start">Utilisateur</th>
              <th className="px-4 py-3 text-end">{t.common.amount}</th>
              <th className="px-4 py-3 text-end">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.items.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2.5">{e.expenseDate}</td>
                <td className="px-4 py-2.5 font-bold text-slate-900">{e.description}</td>
                <td className="px-4 py-2.5">{lang === 'ar' ? e.categoryNameAr : e.categoryNameFr}</td>
                <td className="px-4 py-2.5 text-slate-500">{e.userName}</td>
                <td className="px-4 py-2.5 text-end font-bold text-red-600">
                  {formatMoney(e.amountCents, lang)}
                </td>
                <td className="px-4 py-2.5 text-end">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => {
                        setEditId(e.id)
                        setDescription(e.description)
                        setCategoryId(e.categoryId)
                        setAmount(String(fromCents(e.amountCents)))
                        setExpenseDate(e.expenseDate)
                        setMethod(e.method)
                        setNotes(e.notes ?? '')
                      }}
                      className="rounded border border-slate-200 p-1.5 text-slate-600"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Supprimer "${e.description}" ?`)) return
                        try {
                          await window.api.deleteExpense(e.id)
                          load()
                        } catch (err) {
                          notifyError(err)
                        }
                      }}
                      className="rounded border border-red-200 p-1.5 text-red-600"
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

