import React, { useEffect, useState } from 'react'
import { Plus, Edit3, Trash2 } from 'lucide-react'
import { useAppStore, useT } from '../store'

export function CategoriesPage() {
  const { t } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const user = useAppStore((s) => s.user)
  const canManage = user?.role === 'ADMIN' || user?.permissions.includes('categories.manage')

  const [categories, setCategories] = useState<Awaited<ReturnType<typeof window.api.listCategories>>>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [nameFr, setNameFr] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [active, setActive] = useState(true)

  const load = async () => {
    try {
      setCategories(await window.api.listCategories())
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
      await window.api.saveCategory(editId, { nameFr, nameAr: nameAr || null, active })
      setEditId(null)
      setNameFr('')
      setNameAr('')
      setActive(true)
      notify('success', t.common.save)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer cette catégorie ?')) return
    try {
      await window.api.deleteCategory(id)
      load()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {canManage && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="mb-4 text-sm font-bold text-slate-900">
            {editId ? t.common.edit : t.common.add} — {t.nav.categories}
          </h3>
          <form onSubmit={handleSave} className="space-y-3 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-slate-700">Nom (Français) *</label>
              <input
                type="text"
                required
                value={nameFr}
                onChange={(e) => setNameFr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-slate-700">الاسم بالعربية</label>
              <input
                type="text"
                dir="rtl"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
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
                    setNameFr('')
                    setNameAr('')
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                >
                  {t.common.cancel}
                </button>
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" />
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs lg:col-span-2">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-start">Français</th>
              <th className="px-4 py-3 text-start">العربية</th>
              <th className="px-4 py-3 text-end">Produits</th>
              <th className="px-4 py-3 text-end">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2.5 font-bold text-slate-900">{c.nameFr}</td>
                <td className="px-4 py-2.5 text-slate-700" dir="rtl">
                  {c.nameAr || '—'}
                </td>
                <td className="px-4 py-2.5 text-end font-semibold">{c.productCount}</td>
                <td className="px-4 py-2.5 text-end">
                  {canManage && (
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => {
                          setEditId(c.id)
                          setNameFr(c.nameFr)
                          setNameAr(c.nameAr ?? '')
                          setActive(c.active)
                        }}
                        className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

