// Electron 主进程启动原语探针（正常权限下运行）
const { app, shell } = require('electron')
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const OUT = 'E:/AI WorkRegion/app_creator/scripts/out/electron-probe.json'
const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const record = (name, value) => {
  results.push({ name, value, at: new Date().toISOString() })
  console.log(name, '=>', JSON.stringify(value))
}

function spawnDetached(file, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.once('spawn', () => {
        child.unref()
        setTimeout(() => done({ ok: true, pid: child.pid }), 50)
      })
      child.once('error', (error) => done({ ok: false, error: String(error) }))
      setTimeout(() => done({ ok: true, pid: child.pid, timeout: true }), 900)
    } catch (error) {
      resolve({ ok: false, error: String(error) })
    }
  })
}

async function main() {
  record('versions', process.versions)

  // 1) ms-settings:
  try {
    await shell.openExternal('ms-settings:')
    record('openExternal(ms-settings:)', { ok: true })
  } catch (error) {
    record('openExternal(ms-settings:)', { ok: false, error: String(error) })
  }
  await sleep(2500)

  // 2) shell:AppsFolder 计算器
  try {
    await shell.openExternal('shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    record('openExternal(shell:AppsFolder calc)', { ok: true })
  } catch (error) {
    record('openExternal(shell:AppsFolder calc)', { ok: false, error: String(error) })
  }
  await sleep(3000)

  // 3) shell.openPath 普通 exe（cmd）
  try {
    const error = await shell.openPath('C:\\Windows\\System32\\cmd.exe')
    record('openPath(cmd.exe)', { ok: error === '', error })
  } catch (error) {
    record('openPath(cmd.exe)', { ok: false, error: String(error) })
  }
  await sleep(2500)

  // 4) spawn explorer.exe shell:AppsFolder 记事本
  record('spawn(explorer shell:AppsFolder notepad)', await spawnDetached('explorer.exe', ['shell:AppsFolder\\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App']))
  await sleep(3000)

  // 5) spawn explorer.exe 文件夹
  record('spawn(explorer C:\\Users\\Public)', await spawnDetached('explorer.exe', ['C:\\Users\\Public']))
  await sleep(2500)

  writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8')
  console.log('PROBE_DONE')
  app.quit()
}

app.whenReady().then(main).catch((error) => {
  record('fatal', String(error))
  writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8')
  app.quit()
})
