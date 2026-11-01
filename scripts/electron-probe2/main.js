// 测试从 Electron 主进程发起各种 ShellExecute 启动方式的可靠性
const { app } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const OUT = 'E:/AI WorkRegion/app_creator/scripts/out/electron-probe2.json'
const PROBE = 'E:/AI WorkRegion/app_creator/scripts/out/win-probe.exe'
const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function processNames() {
  try {
    const raw = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
    const names = new Set()
    for (const line of raw.split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line.trim())
      if (m) names.add(m[1].toLowerCase())
    }
    return names
  } catch {
    return new Set()
  }
}

function windows() {
  try {
    return JSON.parse(execFileSync(PROBE, ['WINS'], { encoding: 'utf8', windowsHide: true }).trim())
  } catch {
    return []
  }
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
      setTimeout(() => done({ ok: true, pid: child.pid, timeout: true }), 1500)
    } catch (error) {
      resolve({ ok: false, error: String(error) })
    }
  })
}

async function step(name, launch, watch) {
  const beforeProcs = processNames()
  const beforeWins = windows()
  const launched = await launch()
  await sleep(3000)
  const afterProcs = processNames()
  const afterWins = windows()
  const newProcs = [...afterProcs].filter((p) => !beforeProcs.has(p) && watch.some((w) => p.includes(w)))
  const beforeTitles = new Set(beforeWins.map((w) => `${w.pid}:${w.title}`))
  const newWins = afterWins
    .filter((w) => !beforeTitles.has(`${w.pid}:${w.title}`))
    .map((w) => ({ pid: w.pid, proc: w.proc, title: w.title, min: w.min }))
  const entry = { name, launched, newProcs, newWins }
  results.push(entry)
  console.log('STEP', name, JSON.stringify(entry))
}

async function main() {
  // A: cmd /c start shell:AppsFolder 计算器
  await step(
    'cmd-start-shellAppsFolder-calc',
    () => spawnDetached('cmd.exe', ['/c', 'start', '""', 'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App']),
    ['calculator']
  )

  // B: powershell Start-Process shell:AppsFolder 记事本
  await step(
    'powershell-StartProcess-shellAppsFolder-notepad',
    () =>
      spawnDetached('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        "Start-Process -FilePath 'shell:AppsFolder\\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App'"
      ]),
    ['notepad']
  )

  // C: cmd /c start 普通 exe（cmd.exe 窗口）
  await step(
    'cmd-start-exe-cmd',
    () => spawnDetached('cmd.exe', ['/c', 'start', '""', 'C:\\Windows\\System32\\cmd.exe']),
    ['cmd']
  )

  // D: cmd /c start 文件夹
  await step(
    'cmd-start-folder-public',
    () => spawnDetached('cmd.exe', ['/c', 'start', '""', 'C:\\Users\\Public']),
    ['explorer']
  )

  // E: powershell Start-Process ms-settings:
  await step(
    'powershell-StartProcess-ms-settings',
    () =>
      spawnDetached('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        "Start-Process -FilePath 'ms-settings:'"
      ]),
    ['systemsettings', 'applicationframehost']
  )

  writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8')
  console.log('PROBE2_DONE')
  app.quit()
}

app.whenReady().then(main)
