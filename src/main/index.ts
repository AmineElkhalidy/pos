import { app, BrowserWindow, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase, type DB } from './db/connection'
import { registerIpcHandlers } from './ipc'
import { getSettings } from './services/common'
import { createBackup, defaultBackupDirectory, detectRemovableDrives } from './services/backup'
import { scaleService } from './services/scale'

let db: DB | null = null
let dbPath = ''
let autoBackupTimer: NodeJS.Timeout | null = null

function initDatabase(): void {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  mkdirSync(dataDir, { recursive: true })
  dbPath = join(dataDir, 'smartpos.sqlite')
  db = openDatabase(dbPath)
}

function scheduleAutoBackups(): void {
  if (autoBackupTimer) clearInterval(autoBackupTimer)
  const checkAndRun = async () => {
    if (!db) return
    try {
      const cfg = getSettings(db).backup
      if (!cfg.autoEnabled) return
      const last = db
        .prepare(`SELECT created_at FROM backup_history WHERE status = 'success' ORDER BY id DESC LIMIT 1`)
        .get() as { created_at: string } | undefined
      const intervalMs = Math.max(1, cfg.intervalHours || 24) * 3600_000
      const due = !last || Date.now() - new Date(last.created_at).getTime() >= intervalMs
      if (!due) return
      const targetDir = cfg.localDir || defaultBackupDirectory(app.getPath('userData'))
      await createBackup(db, { targetDir, destinationType: 'auto', userId: null })
      if (cfg.autoToUsb) {
        const usbTarget = cfg.usbDir || detectRemovableDrives()[0]?.backupPath
        if (usbTarget) {
          await createBackup(db, { targetDir: usbTarget, destinationType: 'usb', userId: null }).catch(() => undefined)
        }
      }
    } catch {
      // ignore background auto-backup errors
    }
  }
  setTimeout(checkAndRun, 15_000)
  autoBackupTimer = setInterval(checkAndRun, 30 * 60_000)
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
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

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
          await createBackup(db, { targetDir, destinationType: 'auto', userId: null }).catch(() => undefined)
        }
        db.pragma('wal_checkpoint(TRUNCATE)')
        db.close()
      } catch {
        // ignore
      }
      db = null
    }
    if (process.platform !== 'darwin') app.quit()
  })
}

