import { create } from 'zustand'
import type { SessionUser } from '../../main/services/common'
import type { ProductRow } from '../../main/services/products'
import type { CashSessionSummary } from '../../main/services/cash'
import type { AppSettings } from '@shared/settings'
import type { Discount } from '@shared/cart'
import { toProductMilli, type UnitCode } from '@shared/units'
import { TRANSLATIONS, translateError, type Lang } from './i18n'

export type NavSection =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'categories'
  | 'stock'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'credits'
  | 'expenses'
  | 'barcodes'
  | 'reports'
  | 'users'
  | 'settings'

export interface PosCartItem {
  key: string
  product: ProductRow
  entryQty: string
  entryUnit: UnitCode
  qtyMilli: number
  unitPriceCents: number
  discount: Discount | null
}

export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  user: SessionUser | null
  lang: Lang
  section: NavSection
  settings: AppSettings | null
  cashSession: CashSessionSummary | null
  toasts: ToastItem[]
  lastError: { id: number; code?: string; message: string } | null
  previewHtml: { title: string; html: string; onPrint?: () => Promise<void>; onPdf?: () => Promise<void> } | null

  // POS persistent cart state (survives language switch and page navigation)
  cart: PosCartItem[]
  cartDiscount: Discount | null
  selectedCustomerId: number | null

  setUser: (u: SessionUser | null) => void
  setLang: (lang: Lang) => void
  setSection: (s: NavSection) => void
  setSettings: (s: AppSettings) => void
  setCashSession: (cs: CashSessionSummary | null) => void
  notify: (type: ToastItem['type'], message: string) => void
  notifyError: (err: unknown) => string
  clearError: () => void
  dismissToast: (id: number) => void
  setPreviewHtml: (p: AppState['previewHtml']) => void

  // Cart operations
  addProductToCart: (product: ProductRow, entryQty?: string | number, entryUnit?: UnitCode) => void
  updateCartItemQty: (key: string, entryQty: string, entryUnit?: UnitCode) => void
  updateCartItemDiscount: (key: string, discount: Discount | null) => void
  removeCartItem: (key: string) => void
  setCartDiscount: (d: Discount | null) => void
  setSelectedCustomerId: (id: number | null) => void
  clearCart: () => void
}

let toastSeq = 1

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  lang: 'fr',
  section: 'dashboard',
  settings: null,
  cashSession: null,
  toasts: [],
  lastError: null,
  previewHtml: null,
  cart: [],
  cartDiscount: null,
  selectedCustomerId: null,

  setUser: (user) => {
    set({ user, lastError: null })
    if (user?.language) {
      get().setLang(user.language)
    }
  },
  setLang: (lang) => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    set({ lang })
  },
  setSection: (section) => set({ section, lastError: null }),
  setSettings: (settings) => set({ settings }),
  setCashSession: (cashSession) => set({ cashSession }),

  notify: (type, message) => {
    const id = toastSeq++
    set((s) => ({
      toasts: [...s.toasts, { id, type, message }],
      lastError: type === 'error' ? { id, message } : type === 'success' ? null : s.lastError
    }))
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      },
      type === 'error' ? 6500 : 4200
    )
  },
  notifyError: (err) => {
    const msg = translateError(err, get().lang)
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : undefined
    const id = toastSeq++
    set((s) => ({
      toasts: [...s.toasts, { id, type: 'error', message: msg }],
      lastError: { id, code, message: msg }
    }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 6500)
    return msg
  },
  clearError: () => set({ lastError: null }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPreviewHtml: (previewHtml) => set({ previewHtml }),

  addProductToCart: (product, entryQty = '1', entryUnit) => {
    const unit = entryUnit ?? product.unitCode
    let addMilli = 0
    try {
      addMilli = toProductMilli(entryQty, unit, product.unitCode)
    } catch (err) {
      get().notifyError(err)
      return
    }
    if (addMilli <= 0) return
    set((s) => {
      const existingIdx = s.cart.findIndex((c) => c.product.id === product.id && c.entryUnit === unit)
      if (existingIdx >= 0) {
        const next = [...s.cart]
        const cur = next[existingIdx]
        const newQtyNum = Number(String(cur.entryQty).replace(',', '.')) + Number(String(entryQty).replace(',', '.'))
        const newEntryQty = String(Number(newQtyNum.toFixed(3)))
        const newMilli = toProductMilli(newEntryQty, unit, product.unitCode)
        next[existingIdx] = { ...cur, product, entryQty: newEntryQty, qtyMilli: newMilli }
        return { cart: next }
      }
      return {
        cart: [
          ...s.cart,
          {
            key: `${product.id}-${unit}-${Date.now()}`,
            product,
            entryQty: String(entryQty),
            entryUnit: unit,
            qtyMilli: addMilli,
            unitPriceCents: product.salePriceCents,
            discount: null
          }
        ]
      }
    })
  },

  updateCartItemQty: (key, entryQty, entryUnit) => {
    set((s) => ({
      cart: s.cart.map((item) => {
        if (item.key !== key) return item
        const u = entryUnit ?? item.entryUnit
        let qtyMilli = item.qtyMilli
        try {
          const parsed = Number(String(entryQty).replace(',', '.'))
          if (parsed > 0) qtyMilli = toProductMilli(entryQty, u, item.product.unitCode)
        } catch {
          // keep previous milli while user types decimal
        }
        return { ...item, entryQty, entryUnit: u, qtyMilli }
      })
    }))
  },

  updateCartItemDiscount: (key, discount) => {
    set((s) => ({ cart: s.cart.map((it) => (it.key === key ? { ...it, discount } : it)) }))
  },

  removeCartItem: (key) => set((s) => ({ cart: s.cart.filter((it) => it.key !== key) })),
  setCartDiscount: (cartDiscount) => set({ cartDiscount }),
  setSelectedCustomerId: (selectedCustomerId) => set({ selectedCustomerId }),
  clearCart: () => set({ cart: [], cartDiscount: null, selectedCustomerId: null })
}))

export function useT() {
  const lang = useAppStore((s) => s.lang)
  return { t: TRANSLATIONS[lang], lang, isRtl: lang === 'ar' }
}

