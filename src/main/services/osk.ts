import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { logger } from './logger'

const TABTIP_PATHS = [
  'C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe',
  'C:\\Program Files (x86)\\Common Files\\microsoft shared\\ink\\TabTip.exe'
]

/**
 * Opens the native Windows Touch Keyboard (TabTip.exe) with fallback to osk.exe.
 * Runs detached and non-blocking so it never freezes the Electron main process.
 */
export function openTouchKeyboard(): { ok: boolean; method: string } {
  if (process.platform !== 'win32') {
    return { ok: false, method: 'unsupported' }
  }
  try {
    const tabTip = TABTIP_PATHS.find((p) => existsSync(p))
    if (tabTip) {
      const child = spawn('cmd.exe', ['/c', 'start', '', tabTip], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
      return { ok: true, method: 'TabTip' }
    }
    const osk = spawn('cmd.exe', ['/c', 'start', '', 'osk.exe'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    osk.unref()
    return { ok: true, method: 'osk' }
  } catch (err) {
    logger.warn('osk', 'Failed to open Windows On-Screen Keyboard', err)
    return { ok: false, method: 'error' }
  }
}

/**
 * Dismisses the Windows On-Screen Keyboard if open.
 * Uses graceful close for osk.exe; TabTip auto-hides on blur on Windows 10/11.
 */
export function closeTouchKeyboard(): { ok: boolean } {
  if (process.platform !== 'win32') return { ok: false }
  try {
    execFile('taskkill', ['/IM', 'osk.exe'], { windowsHide: true, timeout: 2000 }, () => undefined)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
