import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing using Node's built-in scrypt (memory-hard KDF).
 * Format: scrypt$N$r$p$saltHex$hashHex
 */
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltHex, hashHex] = parts
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024
  })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

