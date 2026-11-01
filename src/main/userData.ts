import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 在受限运行环境（AppContainer / 低完整性令牌 / 只读用户目录）下，
 * %APPDATA%\nexus-dock 可能无法写入，此时 Electron 连单实例锁和 GPU 缓存都创建不了，
 * 表现为「进程启动后立刻静默退出」。
 *
 * 这里在 app ready 之前探测真实可写性（建目录 + 写文件 + 删文件），
 * 按顺序回退到可用目录，保证应用在任何环境下都能启动。
 */
function isWritable(dir: string): boolean {
  const probe = join(dir, `.write-probe-${process.pid}`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(probe, 'ok', 'utf8')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

export function resolveUserDataDir(): string {
  const candidates: string[] = []
  try {
    candidates.push(app.getPath('userData'))
  } catch {
    /* ignore */
  }
  const localAppData = process.env['LOCALAPPDATA']
  if (localAppData) candidates.push(join(localAppData, 'nexus-dock'))
  try {
    candidates.push(join(app.getPath('temp'), 'nexus-dock'))
  } catch {
    /* ignore */
  }
  candidates.push(join(process.cwd(), '.userdata'))
  candidates.push(join(app.getPath('appData'), 'nexus-dock'))

  for (const dir of candidates) {
    if (isWritable(dir)) return dir
  }
  return candidates[0] ?? join(process.cwd(), '.userdata')
}

/** 必须在 app ready 之前调用 */
export function setupUserDataDir(): string {
  const dir = resolveUserDataDir()
  try {
    app.setPath('userData', dir)
  } catch (error) {
    console.error('[userData] 设置失败：', error)
  }
  console.log('[userData] 使用目录：', dir)
  return dir
}
