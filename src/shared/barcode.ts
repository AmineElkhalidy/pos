/**
 * Barcode helpers.
 *
 * Internal store codes:
 *  - EAN-13 internal codes use the GS1 "restricted circulation" prefix range 20–29
 *    (reserved for in-store use, never assigned to manufacturers). We use prefix "2" + "0"..."9"
 *    configurable, default "21". These are NOT official GS1 manufacturer barcodes.
 *  - Code 128 internal codes use the "SP" prefix followed by a zero-padded sequence.
 */

export type BarcodeFormat = 'EAN13' | 'CODE128' | 'EAN8' | 'UPCA' | 'OTHER'

/** Computes the EAN/UPC check digit for the given digits (without check digit). */
export function eanCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error('INVALID_DIGITS')
  let total = 0
  // Weights 3,1,3,1... from the rightmost data digit.
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i])
    total += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (total % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return eanCheckDigit(code.slice(0, 12)) === Number(code[12])
}

export function isValidEan8(code: string): boolean {
  if (!/^\d{8}$/.test(code)) return false
  return eanCheckDigit(code.slice(0, 7)) === Number(code[7])
}

export function isValidUpcA(code: string): boolean {
  if (!/^\d{12}$/.test(code)) return false
  return eanCheckDigit(code.slice(0, 11)) === Number(code[11])
}

/** Builds an internal EAN-13 from a 2-digit restricted prefix (20-29) and a numeric sequence. */
export function buildInternalEan13(prefix: string, sequence: number): string {
  if (!/^2\d$/.test(prefix)) throw new Error('EAN_PREFIX_MUST_BE_20_29')
  const body = prefix + String(sequence).padStart(10, '0')
  if (body.length !== 12) throw new Error('EAN_SEQUENCE_OVERFLOW')
  return body + eanCheckDigit(body)
}

export function buildInternalCode128(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(6, '0')}`
}

/** Detects the most plausible format of a scanned/entered code. */
export function detectFormat(code: string): BarcodeFormat {
  if (isValidEan13(code)) return 'EAN13'
  if (isValidEan8(code)) return 'EAN8'
  if (isValidUpcA(code)) return 'UPCA'
  if (/^[\x20-\x7E]+$/.test(code)) return 'CODE128'
  return 'OTHER'
}

/** True when an EAN-13 lies in the in-store restricted-circulation range (prefix 20–29). */
export function isInternalEan13(code: string): boolean {
  return isValidEan13(code) && code[0] === '2'
}

/** Normalizes scanner input (trims whitespace / control chars). */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

