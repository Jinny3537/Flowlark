import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'

/**
 * 离线版本生成：把原型引用的 CDN 资源抓下来内联，产出一个自包含的 HTML。
 *
 * 为什么需要：AI 生成的原型几乎都引 CDN（Tailwind、ECharts、Google Fonts）。
 * 断网、上高铁、公司代理拦截时原型会掉样式，而用户的第一反应永远是「这工具坏了」。
 *
 * 两个刻意的设计：
 *
 * 1. **不修改原型文件本身**。原型是需求追溯的证据，R4 说它确认后不可变。
 *    离线版是派生产物，存在 .protohub/cache/offline/ 下，随时可重新生成，也不进 Git。
 *    这样连基线版本也能生成离线版，不违反不可变性。
 *
 * 2. **全部内联成单文件**，不落一堆 assets。和产品「一个版本 = 一个文件」的
 *    心智一致，拷给别人也是一个文件的事。
 */

const EXTERNAL_TAG = /<(script|link|img)\b[^>]*>/gi
const URL_ATTR = /\b(src|href)\s*=\s*["'](https?:\/\/[^"'\s]+)["']/i

const MAX_ASSET_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15000

export function offlinePath(root, slug, versionNo) {
  return path.join(root, '.protohub', 'cache', 'offline', slug, `${versionNo}.html`)
}

export function hasOffline(root, slug, versionNo) {
  return fs.existsSync(offlinePath(root, slug, versionNo))
}

export function readOffline(root, slug, versionNo) {
  const f = offlinePath(root, slug, versionNo)
  return fs.existsSync(f) ? fs.readFileSync(f) : null
}

export function clearOffline(root, slug, versionNo) {
  const f = offlinePath(root, slug, versionNo)
  if (fs.existsSync(f)) fs.rmSync(f)
}

async function fetchAsset(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_ASSET_BYTES) {
      return { ok: false, reason: `资源过大 ${(buf.length / 1024 / 1024).toFixed(1)}MB` }
    }
    return {
      ok: true,
      buf,
      contentType: (res.headers.get('content-type') || '').split(';')[0].trim()
    }
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? '超时' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

function escapeForScript(text) {
  // 内联脚本里出现 </script> 会提前闭合标签，必须转义
  return text.replace(/<\/(script)/gi, '<\\/$1')
}

/**
 * @returns {Promise<{ok:boolean, total:number, inlined:number, failed:Array<{url:string,reason:string}>, bytes:number}>}
 */
export async function buildOffline(root, slug, versionNo, htmlBuffer) {
  let html = htmlBuffer.toString('utf8')
  const failed = []
  let inlined = 0
  let total = 0

  // 先收集所有待抓取的 URL，并发下载后再统一替换 —— 串行抓十几个 CDN 会很慢
  const tasks = []
  const tags = html.match(EXTERNAL_TAG) || []
  for (const tag of tags) {
    const m = URL_ATTR.exec(tag)
    if (!m) continue
    total++
    tasks.push({ tag, attr: m[1], url: m[2] })
  }

  const fetched = await Promise.all(tasks.map(async (t) => ({ ...t, res: await fetchAsset(t.url) })))

  for (const t of fetched) {
    if (!t.res.ok) {
      failed.push({ url: t.url, reason: t.res.reason })
      continue
    }
    const lowerTag = t.tag.toLowerCase()
    let replacement = null

    if (lowerTag.startsWith('<script')) {
      replacement = `<script>${escapeForScript(t.res.buf.toString('utf8'))}</script>`
    } else if (lowerTag.startsWith('<link')) {
      const isCss = /stylesheet/i.test(t.tag) || t.res.contentType === 'text/css'
      if (isCss) {
        // CSS 里可能还引用了字体，这里不再递归抓取：@font-face 失效只是字体回退，
        // 不影响布局，而递归抓取会让复杂度和失败面都放大
        replacement = `<style>${t.res.buf.toString('utf8')}</style>`
      } else {
        // favicon 之类，转成 data URI 塞回原标签
        replacement = t.tag.replace(URL_ATTR, `${t.attr}="${dataUri(t.res)}"`)
      }
    } else if (lowerTag.startsWith('<img')) {
      replacement = t.tag.replace(URL_ATTR, `${t.attr}="${dataUri(t.res)}"`)
    }

    if (replacement) {
      html = html.replace(t.tag, () => replacement)
      inlined++
    }
  }

  const banner = `<!-- protohub 离线版本：${slug}/${versionNo}
     生成于 ${new Date().toISOString()}
     已内联 ${inlined}/${total} 个外部资源${failed.length ? `，${failed.length} 个抓取失败` : ''}
     这是派生产物，原型文件本身未被修改。 -->\n`

  const out = Buffer.from(banner + html, 'utf8')
  const f = offlinePath(root, slug, versionNo)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, out)

  return { ok: failed.length === 0, total, inlined, failed, bytes: out.length, file: f }
}

function dataUri(res) {
  const type = res.contentType || 'application/octet-stream'
  return `data:${type};base64,${res.buf.toString('base64')}`
}

export function assertFetchAvailable() {
  if (typeof fetch !== 'function') {
    throw err.bad('FETCH_UNAVAILABLE', '当前 Node 版本没有内置 fetch', '需要 Node 18 以上')
  }
}
