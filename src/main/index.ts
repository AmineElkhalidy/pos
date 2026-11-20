import { app, BrowserWindow, shell } from 'electron'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeDatabase, openDatabase, quickIntegrityCheck, type DB } from './db/connection'
import { registerIpcHandlers } from './ipc'
import { getSettings } from './services/common'
import {
  configureBackupKeyPath,
  copyVerifiedBackupToUsb,
  createBackup,
  defaultBackupDirectory,
  detectRemovableDrives
} from './services/backup'
import { initLogger, logger } from './services/logger'
import { scaleService } from './services/scale'

let db: DB | null = null
let dbPath = ''
let lockFilePath = ''
let autoBackupTimer: NodeJS.Timeout | null = null

function initDatabase(): void {
  const userData = app.getPath('userData')
  initLogger(userData)
  const dataDir = join(userData, 'data')
  mkdirSync(dataDir, { recursive: true })
  dbPath = join(dataDir, 'smartpos.sqlite')
  lockFilePath = join(dataDir, '.running.lock')
  configureBackupKeyPath(join(dataDir, '.backup.key'))

  const uncleanShutdown = existsSync(lockFilePath)
  try {
    writeFileSync(lockFilePath, new Date().toISOString(), 'utf8')
  } catch {
    // ignore
  }

  db = openDatabase(dbPath)
  if (uncleanShutdown) {
    logger.warn('startup', 'Previous session did not shut down cleanly; running integrity check')
    const check = quickIntegrityCheck(db)
    if (!check.ok) {
      logger.error('startup', 'Database integrity check failed after unclean shutdown', { messages: check.messages })
    } else {
      logger.info('startup', 'Post-crash quick_check passed OK')
    }
  }
}

function scheduleAutoBackups(): void {
  if (autoBackupTimer) clearInterval(autoBackupTimer)
  const checkAndRun = async () => {
    if (!db) return
    try {
      const cfg = getSettings(db).backup
      if (!cfg.autoEnabled) return
      const last = db
        .prepare(`SELECT created_at FROM backup_history WHERE status = 'success' AND verified = 1 ORDER BY id DESC LIMIT 1`)
        .get() as { created_at: string } | undefined
      const intervalMs = Math.max(1, cfg.intervalHours || 1) * 3600_000
      const due = !last || Date.now() - new Date(last.created_at).getTime() >= intervalMs
      if (!due) return
      const targetDir = cfg.localDir || defaultBackupDirectory(app.getPath('userData'))
      const rec = await createBackup(db, { targetDir, destinationType: 'auto', userId: null })
      if (cfg.autoToUsb) {
        const usbTarget = cfg.usbDir || detectRemovableDrives()[0]?.backupPath
        if (usbTarget) {
          try {
            copyVerifiedBackupToUsb(db, rec, usbTarget, null)
          } catch (usbErr) {
            logger.warn('backup', 'Auto USB copy failed (non-fatal)', usbErr)
          }
        }
      }
    } catch (err) {
      logger.error('backup', 'Background auto-backup failed', err)
    }
  }
  setTimeout(checkAndRun, 15_000)
  autoBackupTimer = setInterval(checkAndRun, 10 * 60_000)
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'Smart POS',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      // block invalid or unsafe URLs
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

process.on('uncaughtException', (err) => {
  logger.error('process', 'Uncaught exception in main process', err)
})
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled promise rejection in main process', reason)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.smartpos.desktop')
    initDatabase()
    registerIpcHandlers(
      () => {
        if (!db) initDatabase()
        return db!
      },
      () => dbPath
    )
    scheduleAutoBackups()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', async () => {
    if (autoBackupTimer) clearInterval(autoBackupTimer)
    await scaleService.disconnect().catch(() => undefined)
    if (db) {
      try {
        const cfg = getSettings(db).backup
        if (cfg.backupOnExit) {
          const targetDir = cfg.localDir || defaultBackupDirectory(app.getPath('userData'))
          await createBackup(db, { targetDir, destinationType: 'auto', userId: null }).catch((err) => {
            logger.warn('backup', 'Exit backup failed', err)
          })
        }
        closeDatabase(db)
      } catch (err) {
        logger.error('shutdown', 'Error closing database cleanly', err)
      }
      db = null
    }
    try {
      if (lockFilePath && existsSync(lockFilePath)) unlinkSync(lockFilePath)
    } catch {
      // ignore
    }
    if (process.platform !== 'darwin') app.quit()
  })
}
