// 对比：Electron 主进程 spawn PowerShell 启动 UWP，捕获输出与错误
const { app } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const OUT = 'E:/AI WorkRegion/app_creator/scripts/out/electron-probe3.json'
const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function runPowerShellCapture(script, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      resolve({ stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: stderr + String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

function procSnapshot() {
  const raw = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const m = /^"([^"]+)"/.exec(line.trim())
      return m ? m[1].toLowerCase() : ''
    })
    .filter(Boolean)
}

async function main() {
  const before = procSnapshot()
  const ps = await runPowerShellCapture(`
$ErrorActionPreference = 'Continue'
Write-Output ('whoami-IL: ' + ((whoami /groups | Select-String 'Mandatory Label') -join ''))
try {
  Start-Process -FilePath 'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' -ErrorAction Stop
  Write-Output 'START_OK'
} catch {
  Write-Output ('START_ERR: ' + $_.Exception.Message)
}
Start-Sleep -Seconds 3
$p = Get-Process CalculatorApp -ErrorAction SilentlyContinue
if ($p) { Write-Output ('CALC_PID=' + (($p | Select-Object -ExpandProperty Id) -join ',')) } else { Write-Output 'CALC_ABSENT' }
`)
  const after = procSnapshot()
  const newProcs = after.filter((p) => !before.includes(p) && /calculator|notepad|systemsettings|applicationframe/.test(p))
  results.push({ name: 'powershell-from-electron-captured', ps, newProcs })
  console.log(JSON.stringify(results[0], null, 2))

  // 再测一次普通 exe（cmd），确认通道本身正常
  const before2 = procSnapshot()
  const ps2 = await runPowerShellCapture(`
try {
  Start-Process -FilePath 'C:\\Windows\\System32\\cmd.exe' -ErrorAction Stop
  Write-Output 'CMD_START_OK'
} catch {
  Write-Output ('CMD_START_ERR: ' + $_.Exception.Message)
}
`)
  const after2 = procSnapshot()
  results.push({ name: 'powershell-from-electron-cmd', ps: ps2, newCmds: after2.filter((p) => p === 'cmd') })
  console.log(JSON.stringify(results[1], null, 2))

  writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8')
  console.log('PROBE3_DONE')
  app.quit()
}

app.whenReady().then(main)
