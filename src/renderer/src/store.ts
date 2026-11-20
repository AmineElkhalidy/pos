import { create } from 'zustand'
import Decimal from 'decimal.js'
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
const CART_STORAGE_KEY = 'smartpos_draft_cart_v1'

interface SavedCartDraft {
  cart: PosCartItem[]
  cartDiscount: Discount | null
  selectedCustomerId: number | null
}

function loadCartDraft(): SavedCartDraft {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return { cart: [], cartDiscount: null, selectedCustomerId: null }
    const parsed = JSON.parse(raw) as Partial<SavedCartDraft>
    return {
      cart: Array.isArray(parsed.cart) ? parsed.cart : [],
      cartDiscount: parsed.cartDiscount ?? null,
      selectedCustomerId: typeof parsed.selectedCustomerId === 'number' ? parsed.selectedCustomerId : null
    }
  } catch {
    return { cart: [], cartDiscount: null, selectedCustomerId: null }
  }
}

function saveCartDraft(draft: SavedCartDraft): void {
  try {
    if (draft.cart.length === 0 && !draft.cartDiscount && !draft.selectedCustomerId) {
      localStorage.removeItem(CART_STORAGE_KEY)
    } else {
      // Omit large base64 product images from draft storage to keep localStorage tiny and fast
      const leanCart = draft.cart.map((it) => ({ ...it, product: { ...it.product, image: null } }))
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ ...draft, cart: leanCart }))
    }
  } catch {
    // ignore storage quota errors
  }
}

const initialDraft = loadCartDraft()

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  lang: 'fr',
  section: 'dashboard',
  settings: null,
  cashSession: null,
  toasts: [],
  lastError: null,
  previewHtml: null,
  cart: initialDraft.cart,
  cartDiscount: initialDraft.cartDiscount,
  selectedCustomerId: initialDraft.selectedCustomerId,

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
        const newQtyDec = new Decimal(String(cur.entryQty).replace(',', '.')).plus(String(entryQty).replace(',', '.'))
        const newEntryQty = newQtyDec.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toString()
        const newMilli = toProductMilli(newEntryQty, unit, product.unitCode)
        next[existingIdx] = { ...cur, product, entryQty: newEntryQty, qtyMilli: newMilli }
        saveCartDraft({ cart: next, cartDiscount: s.cartDiscount, selectedCustomerId: s.selectedCustomerId })
        return { cart: next }
      }
      const nextCart = [
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
      saveCartDraft({ cart: nextCart, cartDiscount: s.cartDiscount, selectedCustomerId: s.selectedCustomerId })
      return { cart: nextCart }
    })
  },

  updateCartItemQty: (key, entryQty, entryUnit) => {
    set((s) => {
      const nextCart = s.cart.map((item) => {
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
      saveCartDraft({ cart: nextCart, cartDiscount: s.cartDiscount, selectedCustomerId: s.selectedCustomerId })
      return { cart: nextCart }
    })
  },

  updateCartItemDiscount: (key, discount) => {
    set((s) => {
      const nextCart = s.cart.map((it) => (it.key === key ? { ...it, discount } : it))
      saveCartDraft({ cart: nextCart, cartDiscount: s.cartDiscount, selectedCustomerId: s.selectedCustomerId })
      return { cart: nextCart }
    })
  },

  removeCartItem: (key) =>
    set((s) => {
      const nextCart = s.cart.filter((it) => it.key !== key)
      saveCartDraft({ cart: nextCart, cartDiscount: s.cartDiscount, selectedCustomerId: s.selectedCustomerId })
      return { cart: nextCart }
    }),
  setCartDiscount: (cartDiscount) =>
    set((s) => {
      saveCartDraft({ cart: s.cart, cartDiscount, selectedCustomerId: s.selectedCustomerId })
      return { cartDiscount }
    }),
  setSelectedCustomerId: (selectedCustomerId) =>
    set((s) => {
      saveCartDraft({ cart: s.cart, cartDiscount: s.cartDiscount, selectedCustomerId })
      return { selectedCustomerId }
    }),
  clearCart: () => {
    saveCartDraft({ cart: [], cartDiscount: null, selectedCustomerId: null })
    set({ cart: [], cartDiscount: null, selectedCustomerId: null })
  }
}))

export function useT() {
  const lang = useAppStore((s) => s.lang)
  return { t: TRANSLATIONS[lang], lang, isRtl: lang === 'ar' }
}

