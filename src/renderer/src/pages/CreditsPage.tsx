import React, { useEffect, useState } from 'react'
import { WalletCards, Printer, CheckCircle2, FileText, X } from 'lucide-react'
import { useAppStore, useT } from '../store'
import { ErrorBanner } from '../components/ErrorBanner'
import type { CustomerRow, StatementEntry } from '../../../main/services/partners'
import { formatMoney, fromCents } from '@shared/money'

export function CreditsPage() {
  const { t, lang } = useT()
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)
  const setPreviewHtml = useAppStore((s) => s.setPreviewHtml)

  const [debtors, setDebtors] = useState<CustomerRow[]>([])
  const [payments, setPayments] = useState<Awaited<ReturnType<typeof window.api.listCustomerPayments>>>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payNotes, setPayNotes] = useState('')
  const [statement, setStatement] = useState<{
    customer: CustomerRow
    entries: StatementEntry[]
    closingBalanceCents: number
  } | null>(null)

  const load = async () => {
    try {
      const [dList, pList] = await Promise.all([
        window.api.listCustomers({ withDebtOnly: true }),
        window.api.listCustomerPayments({})
      ])
      setDebtors(dList)
      setPayments(pList)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openPaymentModal = (c: CustomerRow) => {
    setSelectedCustomer(c)
    setPayAmount(String(fromCents(c.balanceCents)))
    setPayMethod('CASH')
    setPayNotes('')
  }

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCustomer) return
    try {
      const receipt = await window.api.recordCustomerPayment({
        customerId: selectedCustomer.id,
        amount: payAmount,
        method: payMethod,
        notes: payNotes || null
      })
      setSelectedCustomer(null)
      notify('success', `${receipt.receiptNo} — ${formatMoney(receipt.amountCents, lang)}`)
      load()

      const html = await window.api.getCustomerPaymentReceiptHtml(receipt.id)
      setPreviewHtml({
        title: `Reçu ${receipt.receiptNo}`,
        html,
        onPrint: async () => {
          await window.api.printCustomerPaymentReceipt(receipt.id, 'print')
        },
        onPdf: async () => {
          await window.api.printCustomerPaymentReceipt(receipt.id, 'pdf')
        }
      })
    } catch (err) {
      notifyError(err)
    }
  }

  const totalDebt = debtors.reduce((a, c) => a + c.balanceCents, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500 p-2.5 text-white">
            <WalletCards className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-900">{t.dashboard.customerDebts}</div>
            <div className="text-xl font-extrabold text-amber-950">{formatMoney(totalDebt, lang)}</div>
          </div>
        </div>
        <div className="text-xs font-semibold text-amber-800">{debtors.length} clients débiteurs</div>
      </div>

      {/* Debtors Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-800">
          Clients ayant un crédit en cours
        </div>
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
            {debtors.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-400">
                  Aucune dette client en cours.
                </td>
              </tr>
            ) : (
              debtors.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-bold text-slate-900">{c.name}</td>
                  <td className="px-4 py-2.5">{c.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-end">
                    {c.creditLimitCents === null ? '—' : formatMoney(c.creditLimitCents, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end font-extrabold text-amber-700">
                    {formatMoney(c.balanceCents, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="inline-flex gap-1.5">
                      <button
                        onClick={() => openPaymentModal(c)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t.customers.collectPayment}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            setStatement(await window.api.customerStatement(c.id))
                          } catch (err) {
                            notifyError(err)
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold hover:bg-slate-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {t.customers.statement}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Payment History Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-800">
          {t.customers.paymentHistory}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-start">N° Reçu</th>
              <th className="px-4 py-3 text-start">{t.common.date}</th>
              <th className="px-4 py-3 text-start">{t.pos.customer}</th>
              <th className="px-4 py-3 text-start">Mode</th>
              <th className="px-4 py-3 text-end">{t.common.amount}</th>
              <th className="px-4 py-3 text-end">{t.common.print}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2.5 font-bold">{p.receiptNo}</td>
                <td className="px-4 py-2.5">{new Date(p.createdAt).toLocaleString('fr-MA')}</td>
                <td className="px-4 py-2.5 font-semibold">{p.customerName}</td>
                <td className="px-4 py-2.5">{p.method}</td>
                <td className="px-4 py-2.5 text-end font-bold text-emerald-700">
                  {formatMoney(p.amountCents, lang)}
                </td>
                <td className="px-4 py-2.5 text-end">
                  <button
                    onClick={async () => {
                      try {
                        const html = await window.api.getCustomerPaymentReceiptHtml(p.id)
                        setPreviewHtml({
                          title: `Reçu ${p.receiptNo}`,
                          html,
                          onPrint: async () => {
                            await window.api.printCustomerPaymentReceipt(p.id, 'print')
                          },
                          onPdf: async () => {
                            await window.api.printCustomerPaymentReceipt(p.id, 'pdf')
                          }
                        })
                      } catch (err) {
                        notifyError(err)
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-semibold hover:bg-slate-50"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Reçu
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Collect Payment Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-xs">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {t.customers.collectPayment} — {selectedCustomer.name}
              </h3>
              <button onClick={() => setSelectedCustomer(null)} className="rounded p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ErrorBanner className="mb-3" />
            <div className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">
              Dette actuelle : <b className="text-sm">{formatMoney(selectedCustomer.balanceCents, lang)}</b>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between">
                  <label className="font-semibold">{t.common.amount} (DH) *</label>
                  <button
                    type="button"
                    onClick={() => setPayAmount(String(fromCents(selectedCustomer.balanceCents)))}
                    className="font-bold text-emerald-700 hover:underline"
                  >
                    {t.customers.settleFull}
                  </button>
                </div>
                <input
                  type="text"
                  required
                  autoFocus
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.pos.paymentMethod}</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
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
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
                >
                  {t.common.cancel}
                </button>
                <button type="submit" className="rounded-lg bg-emerald-600 px-5 py-2 font-bold text-white">
                  {t.common.confirm}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement Modal */}
      {statement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl text-xs">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {t.customers.statement} — {statement.customer.name}
              </h3>
              <button onClick={() => setStatement(null)} className="rounded p-1 text-slate-400">
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
                  <th className="py-2 text-end">Crédit (-Payé)</th>
                  <th className="py-2 text-end">Solde</th>
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

