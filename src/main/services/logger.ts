import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY'

const MAX_LOG_BYTES = 5 * 1024 * 1024 // 5 MB per log file
const MAX_ROTATED_FILES = 3
const SENSITIVE_KEY_RE = /(password|passwd|secret|token|key|passphrase|pin|hash|credential)/i

let logFilePath: string | null = null

export function initLogger(userDataDir: string): string {
  const logsDir = join(userDataDir, 'logs')
  mkdirSync(logsDir, { recursive: true })
  logFilePath = join(logsDir, 'smartpos.log')
  return logFilePath
}

export function getLogFilePath(): string | null {
  return logFilePath
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[Truncated]'
  if (value === null || value === undefined) return value
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 6).join(' | ') }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redactValue(v, depth + 1)
      }
    }
    return out
  }
  if (typeof value === 'string' && value.length > 500) {
    return value.slice(0, 500) + '...[truncated]'
  }
  return value
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return
    if (statSync(file).size < MAX_LOG_BYTES) return
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const older = `${file}.${i}`
      if (i === MAX_ROTATED_FILES && existsSync(older)) {
        unlinkSync(older)
      } else if (existsSync(older)) {
        renameSync(older, `${file}.${i + 1}`)
      }
    }
    renameSync(file, `${file}.1`)
  } catch {
    // never crash app due to log rotation failure
  }
}

export function writeLog(level: LogLevel, module: string, message: string, meta?: unknown): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(meta !== undefined ? { meta: redactValue(meta) } : {})
  }
  const line = JSON.stringify(entry) + '\n'
  if (logFilePath) {
    try {
      rotateIfNeeded(logFilePath)
      appendFileSync(logFilePath, line, 'utf8')
    } catch {
      // ignore disk errors during logging
    }
  }
}

export const logger = {
  info: (module: string, message: string, meta?: unknown) => writeLog('INFO', module, message, meta),
  warn: (module: string, message: string, meta?: unknown) => writeLog('WARN', module, message, meta),
  error: (module: string, message: string, meta?: unknown) => writeLog('ERROR', module, message, meta),
  security: (module: string, message: string, meta?: unknown) => writeLog('SECURITY', module, message, meta)
}

