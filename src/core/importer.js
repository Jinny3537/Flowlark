import dns from 'node:dns/promises'
import net from 'node:net'
import { err } from './errors.js'
import { detectExternalRefs } from './scan.js'

const REDIRECTS = new Set([301, 302, 303, 307, 308])

function ipv4Number(address) {
  return address.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
}

function inV4(address, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask)
}

export function isPrivateAddress(address) {
  const family = net.isIP(address)
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ].some(([base, bits]) => inV4(address, base, bits))
  }
  if (family === 6) {
    const value = address.toLowerCase().split('%')[0]
    if (value === '::' || value === '::1') return true
    if (value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)) return true
    if (value.startsWith('ff') || value.startsWith('2001:db8:')) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  return true
}

function decodeTitle(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, key) => {
    if (key[0] === '#') {
      const hex = key[1].toLowerCase() === 'x'
      const value = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : raw
    }
    return entities[key.toLowerCase()] || raw
  })
}

export function extractTitle(html) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html || ''))
  return match ? decodeTitle(match[1].replace(/\s+/g, ' ').trim()).slice(0, 200) : ''
}

export function inspectHtml(html) {
  const text = String(html || '')
  if (!/<html\b|<!doctype\s+html/i.test(text)) throw err.bad('IMPORT_NOT_HTML', '内容不是完整的 HTML 文档')
  const buffer = Buffer.from(text, 'utf8')
  return { title: extractTitle(text), size: buffer.length, externalRefs: detectExternalRefs(buffer) }
}

export function validateImportUrl(value) {
  let url
  try { url = new URL(value) } catch { throw err.bad('IMPORT_URL_INVALID', '导入地址不合法') }
  if (!['http:', 'https:'].includes(url.protocol)) throw err.bad('IMPORT_URL_INVALID', '只允许导入 HTTP 或 HTTPS 地址')
  if (url.username || url.password) throw err.bad('IMPORT_URL_CREDENTIALS', '导入地址不能包含用户名或密码')
  if (!url.hostname) throw err.bad('IMPORT_URL_INVALID', '导入地址缺少主机名')
  return url
}

async function assertPublicHost(url, resolver) {
  let addresses
  try {
    addresses = net.isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await resolver(url.hostname, { all: true, verbatim: true })
  } catch {
    throw err.bad('IMPORT_DNS_FAILED', `无法解析导入地址：${url.hostname}`)
  }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw err.bad('IMPORT_PRIVATE_ADDRESS', `已拦截非公网导入目标：${url.hostname}`)
  }
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw err.bad('IMPORT_TOO_LARGE', `远端文件超过 ${(maxBytes / 1024 / 1024).toFixed(0)} MB 上限`)
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw err.bad('IMPORT_TOO_LARGE', `远端文件超过 ${(maxBytes / 1024 / 1024).toFixed(0)} MB 上限`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export async function importUrl(value, {
  maxBytes = 10 * 1024 * 1024,
  timeoutMs = 15000,
  maxRedirects = 5,
  resolver = dns.lookup,
  fetcher = fetch
} = {}) {
  let current = validateImportUrl(value)
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    await assertPublicHost(current, resolver)
    let response
    try {
      response = await fetcher(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9' }
      })
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw err.bad('IMPORT_TIMEOUT', '下载原型超时')
      throw err.bad('IMPORT_FETCH_FAILED', '无法下载原型地址')
    }

    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw err.bad('IMPORT_REDIRECT_INVALID', '远端返回了没有目标地址的跳转')
      if (redirect === maxRedirects) throw err.bad('IMPORT_REDIRECT_LIMIT', `导入地址跳转超过 ${maxRedirects} 次`)
      current = validateImportUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) throw err.bad('IMPORT_FETCH_FAILED', `远端返回 HTTP ${response.status}`)
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw err.bad('IMPORT_CONTENT_TYPE', `远端内容不是 HTML（${contentType || '未声明类型'}）`)
    }
    const buffer = await readLimited(response, maxBytes)
    const html = buffer.toString('utf8')
    const inspected = inspectHtml(html)
    return { sourceUrl: current.toString(), html, contentType, ...inspected }
  }
  throw err.bad('IMPORT_REDIRECT_LIMIT', `导入地址跳转超过 ${maxRedirects} 次`)
}
