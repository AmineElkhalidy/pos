import React, { useEffect, useRef, useState } from 'react'
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
  FolderOpen,
  ImagePlus,
  X
} from 'lucide-react'
import { useAppStore, useT } from '../store'
import type { AppSettings } from '@shared/settings'
import type { BackupRecord, RemovableDrive } from '../../../main/services/backup'
import { fromCents, toCents } from '@shared/money'

/** Resizes an uploaded store logo to a crisp offline data URL (max 320px, <= 400 KB) suitable for thermal receipts. */
async function logoFileToDataUrl(file: File, maxDim = 320): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('INVALID_IMAGE_FILE')
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('INVALID_IMAGE_FILE'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('INVALID_IMAGE_FILE'))
    el.src = raw
  })
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return raw
  ctx.drawImage(img, 0, 0, w, h)
  const mime = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
  return canvas.toDataURL(mime, 0.88)
}

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
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoDragActive, setLogoDragActive] = useState(false)

  const handleLogoFile = async (file?: File | null) => {
    if (!file || !form) return
    try {
      const dataUrl = await logoFileToDataUrl(file)
      if (dataUrl.length > 395000) {
        notify('error', lang === 'ar' ? 'حجم الشعار كبير جداً' : 'Logo trop volumineux (max ~350 Ko).')
        return
      }
      setForm({ ...form, store: { ...form.store, logoDataUrl: dataUrl } })
    } catch {
      notify('error', lang === 'ar' ? 'ملف صورة غير صالح' : 'Fichier image invalide (PNG, JPG ou WebP).')
    }
  }

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
              {/* Store Logo Upload */}
              <div className="sm:col-span-2">
                <label className="mb-1.5 block font-semibold">
                  {lang === 'ar' ? 'شعار المتجر (يظهر في الفاتورة والواجهة)' : 'Logo du magasin (affiché sur le ticket client et la barre latérale)'}
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setLogoDragActive(true)
                  }}
                  onDragLeave={() => setLogoDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setLogoDragActive(false)
                    handleLogoFile(e.dataTransfer.files?.[0])
                  }}
                  className={`flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed p-4 transition ${
                    logoDragActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-slate-50/70'
                  }`}
                >
                  <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
                    {form.store.logoDataUrl ? (
                      <img
                        src={form.store.logoDataUrl}
                        alt="Logo"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Store className="h-8 w-8 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="text-xs text-slate-600">
                      {lang === 'ar'
                        ? 'اسحب صورة الشعار هنا أو انقر لاختيار ملف (PNG / JPG / WebP).'
                        : 'Glissez-déposez le logo ici ou cliquez pour choisir une image (PNG, JPG ou WebP).'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          handleLogoFile(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        {form.store.logoDataUrl
                          ? lang === 'ar'
                            ? 'تغيير الشعار'
                            : 'Changer le logo'
                          : lang === 'ar'
                            ? 'إضافة شعار'
                            : 'Ajouter un logo'}
                      </button>
                      {form.store.logoDataUrl && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, store: { ...form.store, logoDataUrl: '' } })}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100"
                        >
                          <X className="h-3.5 w-3.5" />
                          {lang === 'ar' ? 'حذف' : 'Supprimer'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

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
                <label className="mb-1 block font-semibold">
                  {lang === 'ar' ? 'رقم الهاتف الرسمي للمتجر' : 'Téléphone officiel du magasin'}
                </label>
                <input
                  type="text"
                  placeholder="ex: +212 5 22 00 00 00"
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
                <label className="mb-1 block font-semibold">Email (optionnel)</label>
                <input
                  type="email"
                  value={form.store.email}
                  onChange={(e) => setForm({ ...form, store: { ...form.store, email: e.target.value } })}
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
                <label className="mb-1 block font-semibold">
                  {lang === 'ar' ? 'رسالة الترحيب (أعلى الفاتورة)' : 'Message de bienvenue (en-tête du ticket)'}
                </label>
                <input
                  type="text"
                  placeholder="ex: Bienvenue ! مرحبا بكم"
                  value={form.receipt.headerText}
                  onChange={(e) => setForm({ ...form, receipt: { ...form.receipt, headerText: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block font-semibold">
                  {lang === 'ar' ? 'رسالة الشكر (أسفل الفاتورة)' : 'Message de pied de ticket (remerciement)'}
                </label>
                <input
                  type="text"
                  value={form.receipt.footerText}
                  onChange={(e) => setForm({ ...form, receipt: { ...form.receipt, footerText: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-5">
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={form.receipt.showLogo}
                    onChange={(e) => setForm({ ...form, receipt: { ...form.receipt, showLogo: e.target.checked } })}
                    className="accent-emerald-600"
                  />
                  {lang === 'ar' ? 'طباعة شعار المتجر على الفاتورة' : 'Afficher le logo du magasin sur le ticket'}
                </label>
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={form.receipt.bilingual}
                    onChange={(e) => setForm({ ...form, receipt: { ...form.receipt, bilingual: e.target.checked } })}
                    className="accent-emerald-600"
                  />
                  {lang === 'ar' ? 'فاتورة ثنائية اللغة (فرنسية / عربية)' : 'Ticket bilingue (Français / العربية)'}
                </label>
              </div>

              {/* Live Receipt Header & Footer Preview */}
              <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {lang === 'ar' ? 'معاينة الفاتورة' : 'Aperçu du ticket client'}
                </div>
                <div className="mx-auto max-w-[260px] rounded-lg border border-slate-300 bg-white p-4 text-center text-[11px] text-slate-900 shadow-xs">
                  {form.receipt.showLogo && form.store.logoDataUrl && (
                    <img
                      src={form.store.logoDataUrl}
                      alt="Logo"
                      className="mx-auto mb-1.5 max-h-12 max-w-[120px] object-contain"
                    />
                  )}
                  <div className="text-sm font-extrabold">{form.store.name || 'Smart POS'}</div>
                  {form.store.address && <div className="text-[10px] text-slate-600">{form.store.address}</div>}
                  {form.store.phone && (
                    <div className="text-[10px] text-slate-600">Tél / الهاتف: {form.store.phone}</div>
                  )}
                  {form.store.email && <div className="text-[10px] text-slate-600">{form.store.email}</div>}
                  {form.store.ice && <div className="text-[10px] text-slate-600">ICE: {form.store.ice}</div>}
                  {form.receipt.headerText && (
                    <div className="mt-1 text-[11px] font-semibold text-slate-800">{form.receipt.headerText}</div>
                  )}
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Article exemple × 1</span>
                    <span className="font-bold text-slate-800">25,00 DH</span>
                  </div>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="text-[10px] text-slate-600">{form.receipt.footerText}</div>
                </div>
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

