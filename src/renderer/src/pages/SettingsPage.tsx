import React, { useEffect, useState } from 'react'
import {
  Store,
  ShoppingCart,
  Printer,
  Barcode,
  Scale,
  DatabaseBackup,
  HardDrive,
  Usb,
  RotateCcw,
  CheckCircle2,
  FolderOpen
} from 'lucide-react'
import { useAppStore, useT } from '../store'
import type { AppSettings } from '@shared/settings'
import type { BackupRecord, RemovableDrive } from '../../../main/services/backup'
import { fromCents, toCents } from '@shared/money'

export function SettingsPage() {
  const { t, lang } = useT()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const setLang = useAppStore((s) => s.setLang)
  const notify = useAppStore((s) => s.notify)
  const notifyError = useAppStore((s) => s.notifyError)

  const [tab, setTab] = useState<'store' | 'sales' | 'receipt' | 'labels' | 'scale' | 'backup'>('store')
  const [form, setForm] = useState<AppSettings | null>(settings)
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([])
  const [serialPorts, setSerialPorts] = useState<{ path: string; friendlyName?: string }[]>([])
  const [scaleTestResult, setScaleTestResult] = useState<string | null>(null)

  // Backup state
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [usbDrives, setUsbDrives] = useState<RemovableDrive[]>([])
  const [dbInfo, setDbInfo] = useState<{ dbPath: string; backupDir: string; integrityOk: boolean } | null>(null)

  const loadAll = async () => {
    try {
      const [s, pr, sp, bList, drives, info] = await Promise.all([
        window.api.getSettings(),
        window.api.listPrinters(),
        window.api.listSerialPorts(),
        window.api.listBackups(),
        window.api.detectRemovableDrives(),
        window.api.getDatabaseInfo()
      ])
      setSettings(s)
      setForm(s)
      setPrinters(pr)
      setSerialPorts(sp)
      setBackups(bList)
      setUsbDrives(drives)
      setDbInfo(info)
    } catch (err) {
      notifyError(err)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  if (!form) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const updated = await window.api.updateSettings(form)
      setSettings(updated)
      setForm(updated)
      if (updated.general.language !== lang) {
        setLang(updated.general.language)
      }
      notify('success', t.common.save)
    } catch (err) {
      notifyError(err)
    }
  }

  const handleTestScale = async () => {
    try {
      const res = await window.api.testScaleConnection(form.scale)
      const weightText = res.reading ? ` — Poids lu : ${res.reading.weightGrams} g` : ''
      setScaleTestResult(`${res.ok ? 'OK' : 'ERREUR'} (${res.simulated ? 'SIMULÉE' : 'MATÉRIELLE'}): ${res.message}${weightText}`)
    } catch (err) {
      notifyError(err)
    }
  }

  const handleManualBackup = async (dest: 'local' | 'usb' | 'custom') => {
    try {
      let customDir: string | undefined
      if (dest === 'custom') {
        const chosen = await window.api.chooseFolder()
        if (!chosen) return
        customDir = chosen
      }
      const rec = await window.api.createManualBackup(dest, customDir)
      notify('success', `Sauvegarde vérifiée créée : ${rec.filePath}`)
      setBackups(await window.api.listBackups())
    } catch (err) {
      notifyError(err)
    }
  }

  const handleRestoreBackup = async (filePath?: string) => {
    try {
      const target = filePath ?? (await window.api.chooseBackupFile())
      if (!target) return
      const ver = await window.api.verifyBackup(target)
      if (!ver.ok) {
        notify('error', `Sauvegarde invalide : ${ver.message}`)
        return
      }
      if (
        !confirm(
          `ATTENTION : La restauration remplacera les données actuelles par "${target}". Une sauvegarde de sécurité pré-restauration sera créée automatiquement. Continuer ?`
        )
      ) {
        return
      }
      const res = await window.api.restoreBackup(target)
      notify('success', `Base restaurée avec succès (sauvegarde pré-restauration : ${res.preRestoreBackupPath}).`)
      loadAll()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <div className="space-y-5">
      {/* Settings Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 text-xs font-bold shadow-2xs">
        <button
          onClick={() => setTab('store')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 ${
            tab === 'store' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <Store className="h-3.5 w-3.5" />
          {t.settings.storeTab}
        </button>
        <button
          onClick={() => setTab('sales')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 ${
            tab === 'sales' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {t.settings.salesTab}
        </button>
        <button
          onClick={() => setTab('receipt')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 ${
            tab === 'receipt' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <Printer className="h-3.5 w-3.5" />
          {t.settings.receiptTab}
        </button>
        <button
          onClick={() => setTab('labels')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 ${
            tab === 'labels' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <Barcode className="h-3.5 w-3.5" />
          {t.settings.labelsTab}
        </button>
        <button
          onClick={() => setTab('scale')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 ${
            tab === 'scale' ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          <Scale className="h-3.5 w-3.5" />
          {t.settings.scaleTab}
        </button>
        <button
          onClick={() => setTab('backup')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 ${
            tab === 'backup' ? 'bg-emerald-600 text-white' : 'text-slate-600'
          }`}
        >
          <DatabaseBackup className="h-3.5 w-3.5" />
          {t.settings.backupTab}
        </button>
      </div>

      {tab !== 'backup' ? (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-xs space-y-5">
          {tab === 'store' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold">Nom du magasin *</label>
                <input
                  type="text"
                  required
                  value={form.store.name}
                  onChange={(e) => setForm({ ...form, store: { ...form.store, name: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">{t.customers.phone}</label>
                <input
                  type="text"
                  value={form.store.phone}
                  onChange={(e) => setForm({ ...form, store: { ...form.store, phone: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block font-semibold">{t.customers.address}</label>
                <input
                  type="text"
                  value={form.store.address}
                  onChange={(e) => setForm({ ...form, store: { ...form.store, address: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">ICE (Identifiant Commun de l&apos;Entreprise)</label>
                <input
                  type="text"
                  value={form.store.ice}
                  onChange={(e) => setForm({ ...form, store: { ...form.store, ice: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Langue par défaut</label>
                <select
                  value={form.general.language}
                  onChange={(e) =>
                    setForm({ ...form, general: { ...form.general, language: e.target.value as 'fr' | 'ar' } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                >
                  <option value="fr">Français</option>
                  <option value="ar">العربية (RTL)</option>
                </select>
              </div>
            </div>
          )}

          {tab === 'sales' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold">Préfixe des factures</label>
                <input
                  type="text"
                  value={form.sales.invoicePrefix}
                  onChange={(e) => setForm({ ...form, sales: { ...form.sales, invoicePrefix: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Remise maximale caissier (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.sales.maxCashierDiscountPercent}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sales: { ...form.sales, maxCashierDiscountPercent: Number(e.target.value) }
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Plafond de crédit client par défaut (DH)</label>
                <input
                  type="text"
                  value={
                    form.sales.defaultCreditLimitCents === null
                      ? ''
                      : String(fromCents(form.sales.defaultCreditLimitCents))
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sales: {
                        ...form.sales,
                        defaultCreditLimitCents: e.target.value.trim() ? toCents(e.target.value) : null
                      }
                    })
                  }
                  placeholder="Illimité si vide"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Alerte péremption (jours avant échéance)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.stock.expiryAlertDays}
                  onChange={(e) =>
                    setForm({ ...form, stock: { ...form.stock, expiryAlertDays: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={form.sales.requireCashSession}
                    onChange={(e) =>
                      setForm({ ...form, sales: { ...form.sales, requireCashSession: e.target.checked } })
                    }
                    className="accent-emerald-600"
                  />
                  Exiger une session de caisse ouverte avant toute vente
                </label>
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={form.sales.allowNegativeStock}
                    onChange={(e) =>
                      setForm({ ...form, sales: { ...form.sales, allowNegativeStock: e.target.checked } })
                    }
                    className="accent-emerald-600"
                  />
                  Autoriser le stock négatif lors des ventes
                </label>
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={form.sales.enforceMinPrice}
                    onChange={(e) =>
                      setForm({ ...form, sales: { ...form.sales, enforceMinPrice: e.target.checked } })
                    }
                    className="accent-emerald-600"
                  />
                  Bloquer les ventes sous le prix minimum pour les caissiers
                </label>
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={form.sales.blockOverCreditLimit}
                    onChange={(e) =>
                      setForm({ ...form, sales: { ...form.sales, blockOverCreditLimit: e.target.checked } })
                    }
                    className="accent-emerald-600"
                  />
                  Bloquer les ventes à crédit dépassant le plafond du client
                </label>
              </div>
            </div>
          )}

          {tab === 'receipt' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold">Largeur du papier thermique</label>
                <select
                  value={form.receipt.paperWidth}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      receipt: { ...form.receipt, paperWidth: Number(e.target.value) as 58 | 80 }
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                >
                  <option value={80}>80 mm (Standard)</option>
                  <option value={58}>58 mm (Compact)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold">Mode d&apos;impression</label>
                <select
                  value={form.receipt.mode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      receipt: {
                        ...form.receipt,
                        mode: e.target.value as AppSettings['receipt']['mode']
                      }
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                >
                  <option value="driver">Pilote d&apos;imprimante Windows</option>
                  <option value="pdf">Export PDF (sans imprimante matérielle)</option>
                  <option value="escpos-network">ESC/POS Réseau (TCP 9100)</option>
                  <option value="escpos-serial">ESC/POS Port Série (COM)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold">Imprimante système Windows</label>
                <select
                  value={form.receipt.printerName}
                  onChange={(e) =>
                    setForm({ ...form, receipt: { ...form.receipt, printerName: e.target.value } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Imprimante par défaut</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName} {p.isDefault ? '(Par défaut)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold">Message de pied de ticket</label>
                <input
                  type="text"
                  value={form.receipt.footerText}
                  onChange={(e) => setForm({ ...form, receipt: { ...form.receipt, footerText: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          )}

          {tab === 'labels' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold">Largeur étiquette (mm)</label>
                <input
                  type="number"
                  min={20}
                  max={120}
                  value={form.labels.widthMm}
                  onChange={(e) =>
                    setForm({ ...form, labels: { ...form.labels, widthMm: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Hauteur étiquette (mm)</label>
                <input
                  type="number"
                  min={15}
                  max={120}
                  value={form.labels.heightMm}
                  onChange={(e) =>
                    setForm({ ...form, labels: { ...form.labels, heightMm: Number(e.target.value) } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Préfixe EAN-13 interne (20–29)</label>
                <input
                  type="text"
                  pattern="^2\d$"
                  value={form.labels.internalEanPrefix}
                  onChange={(e) =>
                    setForm({ ...form, labels: { ...form.labels, internalEanPrefix: e.target.value } })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono font-bold"
                />
              </div>
            </div>
          )}

          {tab === 'scale' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold">Protocole / Adaptateur Balance</label>
                  <select
                    value={form.scale.adapter}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scale: { ...form.scale, adapter: e.target.value as AppSettings['scale']['adapter'] }
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  >
                    <option value="simulated">Balance simulée (Développement / Test)</option>
                    <option value="generic">Generic ASCII (ST,GS,+001.250kg)</option>
                    <option value="cas">CAS (ER-JR / PR-II / SW-1)</option>
                    <option value="toledo">Mettler-Toledo SICS (SI)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Port Série (COM)</label>
                  <select
                    value={form.scale.port}
                    onChange={(e) => setForm({ ...form, scale: { ...form.scale, port: e.target.value } })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  >
                    <option value="">— Sélectionner un port —</option>
                    {serialPorts.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.path} ({p.friendlyName})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Vitesse (Baud rate)</label>
                  <select
                    value={form.scale.baudRate}
                    onChange={(e) =>
                      setForm({ ...form, scale: { ...form.scale, baudRate: Number(e.target.value) } })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  >
                    {[2400, 4800, 9600, 19200, 38400, 115200].map((b) => (
                      <option key={b} value={b}>
                        {b} bps
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3.5">
                <button
                  type="button"
                  onClick={handleTestScale}
                  className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white hover:bg-slate-800"
                >
                  Tester la connexion balance
                </button>
                {scaleTestResult && <span className="font-mono text-xs font-semibold">{scaleTestResult}</span>}
              </div>
            </div>
          )}

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button
              type="submit"
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      ) : (
        /* Backup & Restore Tab */
        <div className="space-y-5 text-xs">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Local Backup Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="mb-2 flex items-center gap-2 font-bold text-slate-900">
                <HardDrive className="h-4 w-4 text-emerald-600" />
                {t.settings.backupNowLocal}
              </div>
              <p className="mb-3 text-slate-500">
                Dossier : <span className="font-mono">{dbInfo?.backupDir}</span>
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleManualBackup('local')}
                  className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
                >
                  Sauvegarder maintenant
                </button>
                <button
                  onClick={() => handleManualBackup('custom')}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 font-semibold hover:bg-slate-50"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Autre dossier...
                </button>
              </div>
            </div>

            {/* USB Backup Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="mb-2 flex items-center gap-2 font-bold text-slate-900">
                <Usb className="h-4 w-4 text-sky-600" />
                {t.settings.backupNowUsb}
              </div>
              <p className="mb-3 text-slate-500">
                {usbDrives.length > 0
                  ? `Clé détectée : ${usbDrives.map((d) => `${d.driveLetter} (${d.label})`).join(', ')}`
                  : 'Aucune clé USB amovible détectée actuellement.'}
              </p>
              <button
                onClick={() => handleManualBackup('usb')}
                className="rounded-xl bg-sky-600 px-4 py-2 font-bold text-white hover:bg-sky-700"
              >
                Sauvegarder sur USB
              </button>
            </div>

            {/* Restore Card */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-xs">
              <div className="mb-2 flex items-center gap-2 font-bold text-amber-950">
                <RotateCcw className="h-4 w-4 text-amber-700" />
                {t.settings.restoreFromFile}
              </div>
              <p className="mb-3 text-amber-900">
                Vérifie l’intégrité SQLite et crée une sauvegarde pré-restauration avant d’écraser les données.
              </p>
              <button
                onClick={() => handleRestoreBackup()}
                className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700"
              >
                Choisir un fichier .sqlite à restaurer...
              </button>
            </div>
          </div>

          {/* Backup History */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 font-bold">
              <span>Historique des sauvegardes ({backups.length})</span>
              {dbInfo && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Intégrité SQLite : {dbInfo.integrityOk ? 'OK (WAL actif)' : 'Erreur'}
                </span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2.5 text-start">{t.common.date}</th>
                  <th className="px-4 py-2.5 text-start">Type</th>
                  <th className="px-4 py-2.5 text-start">Fichier</th>
                  <th className="px-4 py-2.5 text-end">Taille</th>
                  <th className="px-4 py-2.5 text-start">Vérification</th>
                  <th className="px-4 py-2.5 text-end">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5">{new Date(b.createdAt).toLocaleString('fr-MA')}</td>
                    <td className="px-4 py-2.5 uppercase font-semibold">{b.destinationType}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">{b.filePath}</td>
                    <td className="px-4 py-2.5 text-end">
                      {b.sizeBytes ? `${(b.sizeBytes / 1024).toFixed(1)} Ko` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.verified ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          SHA-256 OK
                        </span>
                      ) : (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                          {b.message}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      {b.existsOnDisk && b.status === 'success' && (
                        <button
                          onClick={() => handleRestoreBackup(b.filePath)}
                          className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 font-bold text-amber-800 hover:bg-amber-100"
                        >
                          Restaurer
                        </button>
                      )}
                    </td>
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

