const { app, BrowserWindow } = require('electron')

console.log('BOOT electron=', process.versions.electron)
console.log('BOOT app=', typeof app)

app.on('ready', () => {
  console.log('READY')
  const win = new BrowserWindow({ width: 420, height: 260, show: true })
  win.loadURL('data:text/html,<h1 style="font-family:Segoe UI">Nexus probe OK</h1>')
  win.once('ready-to-show', () => console.log('WINDOW_SHOWN'))
  setTimeout(() => {
    console.log('WINDOWS=', BrowserWindow.getAllWindows().length)
    app.quit()
  }, 3000)
})

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('REJECTION', reason)
})
