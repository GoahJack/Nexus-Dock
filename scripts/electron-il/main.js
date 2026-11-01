// 最小检查：Electron 主进程派生 PowerShell 的完整性级别
const { app } = require('electron')
const { spawnSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const OUT = 'E:/AI WorkRegion/app_creator/scripts/out/electron-il.json'

function whoami() {
  try {
    const r = spawnSync('whoami.exe', ['/groups'], { encoding: 'utf8', windowsHide: true })
    const line = String(r.stdout)
      .split(/\r?\n/)
      .find((l) => /Mandatory Label/i.test(l) || /完整性/.test(l))
    return line ? line.trim() : 'unknown'
  } catch (error) {
    return 'ERR ' + String(error)
  }
}

app.whenReady().then(() => {
  const result = {
    mainWhoami: whoami(),
    pid: process.pid,
    commandLine: process.argv,
    noSandbox: process.argv.includes('--no-sandbox'),
    env: { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE ?? null }
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result))
  app.quit()
})
