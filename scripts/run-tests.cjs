/**
 * Runs the Vitest suite inside the Electron runtime (ELECTRON_RUN_AS_NODE=1).
 *
 * Why: better-sqlite3 is a native module compiled against Electron's ABI
 * (via `electron-builder install-app-deps`). Running tests with the same
 * runtime guarantees we test exactly the binary that ships in the app.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const electronPath = require('electron')
const vitestEntry = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs')
const args = [vitestEntry, 'run', ...process.argv.slice(2)]

const res = spawnSync(electronPath, args, {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  cwd: path.join(__dirname, '..')
})
process.exit(res.status ?? 1)

