const path = require('node:path')
const { app } = require('electron')

const log = (...args) => console.log('[debug]', ...args)
const root = process.cwd()

log('BOOT electron=', process.versions.electron)
log('cwd=', root)
log('appPath=', app.getAppPath())
log('userData=', app.getPath('userData'))

process.on('exit', (code) => log('PROCESS_EXIT', code))
process.on('uncaughtException', (error) => log('UNCAUGHT', error && error.stack))
process.on('unhandledRejection', (reason) => log('REJECTION', reason && (reason.stack || String(reason))))

app.on('will-quit', () => log('WILL_QUIT'))
app.on('window-all-closed', () => log('WINDOW_ALL_CLOSED'))
app.on('before-quit', () => log('BEFORE_QUIT'))
app.on('browser-window-created', (_event, win) => {
  log('WINDOW_CREATED', win.getBounds())
  win.on('closed', () => log('WINDOW_CLOSED'))
  win.webContents.on('did-finish-load', () => log('LOADED', win.webContents.getURL()))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('LOAD_FAILED', code, desc, url))
  win.webContents.on('console-message', (_e, level, message) => log('RENDERER_CONSOLE', level, message))
})

try {
  require(path.join(root, 'out', 'main', 'index.js'))
  log('MAIN_REQUIRED_OK')
} catch (error) {
  log('MAIN_REQUIRE_FAILED', error && error.stack)
}

setTimeout(() => {
  log('ALIVE_AFTER_10S windows=', require('electron').BrowserWindow.getAllWindows().length)
}, 10000)
