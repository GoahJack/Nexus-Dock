import { app, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'

const MEDIA_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.opus', '.wma'])

/** 白名单：只有经过 pickFiles 授权过的本地文件才允许通过 media:// 读取 */
const allowedMedia = new Set<string>()

export function allowMediaFile(filePath: string): void {
  allowedMedia.add(resolve(filePath))
}

export function areMediaFilesAllowed(): number {
  return allowedMedia.size
}

export function iconsDir(): string {
  return join(app.getPath('userData'), 'icons')
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma'
}

/**
 * v1.6：自定义图标允许 PNG（默认）/ SVG / JPG / WebP / ICO 等，
 * 必须显式设置 Content-Type，否则 Chromium 可能把 SVG / ICO 当成二进制不渲染。
 */
const ICON_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}

/** 必须在 app ready 之前调用 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'icon',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    },
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

/** 必须在 app ready 之后调用 */
export function registerProtocolHandlers(): void {
  protocol.handle('icon', async (request) => {
    try {
      const url = new URL(request.url)
      // icon://<hash>.png 中文件名位于 host 位置；icon:///<hash>.png 则在 pathname
      const fromPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const name = fromPath || decodeURIComponent(url.hostname)
      if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return new Response('bad request', { status: 400 })
      }
      const target = join(iconsDir(), name)
      if (!existsSync(target)) return new Response('not found', { status: 404 })
      // v1.6：自定义图标可能是 SVG / ICO，直接读文件并显式给 Content-Type，
      // 不依赖 net.fetch(file://) 的扩展名推断（旧实现只服务 PNG）。
      const bytes = await readFile(target)
      const contentType = ICON_MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch (error) {
      console.error('[protocol] icon 失败', error)
      return new Response('error', { status: 500 })
    }
  })

  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const raw = url.searchParams.get('p')
      if (!raw) return new Response('missing p', { status: 400 })
      // searchParams.get 已经做过一次 URL 解码，这里不能再 decodeURIComponent，
      // 否则文件名里含字面 '%'（如 100%.mp3）会抛 URIError
      const filePath = resolve(raw)
      if (!allowedMedia.has(filePath)) return new Response('forbidden', { status: 403 })
      const ext = extname(filePath).toLowerCase()
      if (!MEDIA_EXTENSIONS.has(ext)) return new Response('unsupported media', { status: 415 })
      const info = await stat(filePath).catch(() => null)
      if (!info || !info.isFile()) return new Response('not found', { status: 404 })

      const size = info.size
      const contentType = MIME[ext] ?? 'application/octet-stream'
      const rangeHeader = request.headers.get('range')
      const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null

      if (match) {
        const start = match[1] ? Number.parseInt(match[1], 10) : 0
        const end = match[2] ? Math.min(Number.parseInt(match[2], 10), size - 1) : size - 1
        if (Number.isNaN(start) || Number.isNaN(end) || start >= size || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        }
        const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }

      const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (error) {
      console.error('[protocol] media 失败', error)
      return new Response('error', { status: 500 })
    }
  })
}
