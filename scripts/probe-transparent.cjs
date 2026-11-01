const { app, BrowserWindow, screen } = require('electron')

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: 400,
    height: 160,
    x: Math.round(width / 2 - 200),
    y: Math.round(height / 2 - 80),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true
  })
  win.loadURL(
    'data:text/html,' +
      encodeURIComponent(`<body style="margin:0;background:transparent">
        <div style="width:400px;height:160px;display:grid;place-items:center;font:20px 'Segoe UI';color:#fff;background:rgba(110,168,254,0.85);border-radius:24px">透明测试</div>
      </body>`)
  )
  setTimeout(() => {
    console.log('TRANSPARENT_WINDOW_SHOWN')
  }, 1500)
  setTimeout(() => app.quit(), 9000)
})
