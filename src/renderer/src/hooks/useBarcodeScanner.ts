import { useEffect, useRef } from 'react'

/**
 * Global USB HID Keyboard-Wedge Barcode Scanner listener.
 *
 * How it works:
 * - Hardware barcode scanners emit printable characters at high speed (< 45 ms between keys)
 *   followed by Enter.
 * - When the user is NOT focused on a text input (or is focused on an element marked with
 *   `data-allow-barcode-scan="true"`), rapid character sequences ending in Enter are captured,
 *   prevented from polluting inputs, and dispatched to `onScan(code)`.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const cbRef = useRef(onScan)
  cbRef.current = onScan

  useEffect(() => {
    if (!enabled) return
    let buffer = ''
    let lastTime = 0

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      const allowInThisInput = target?.getAttribute('data-barcode-input') === 'true'

      const now = performance.now()
      const delta = now - lastTime

      if (e.key === 'Enter') {
        if (buffer.length >= 4 && delta < 120) {
          e.preventDefault()
          e.stopPropagation()
          const scanned = buffer.trim()
          buffer = ''
          cbRef.current(scanned)
          return
        }
        buffer = ''
        return
      }

      if (e.key.length === 1) {
        if (isInput && !allowInThisInput) {
          buffer = ''
          return
        }
        if (delta > 85) {
          buffer = e.key
        } else {
          buffer += e.key
        }
        lastTime = now
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}

