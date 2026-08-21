import { PhError } from '../core/errors.js'

/**
 * 极小路由。零依赖是这个项目的一条硬约束 ——
 * 本地工具装起来应该是一秒的事，不该为了几十行路由拖进一棵依赖树。
 */
export class Router {
  constructor() {
    this.routes = []
  }

  add(method, pattern, handler) {
    const names = []
    const regex = new RegExp(
      '^' +
        pattern.replace(/:[A-Za-z]+/g, (m) => {
          names.push(m.slice(1))
          return '([^/]+)'
        }) +
        '$'
    )
    this.routes.push({ method, regex, names, handler })
    return this
  }

  get(p, h) { return this.add('GET', p, h) }
  post(p, h) { return this.add('POST', p, h) }
  put(p, h) { return this.add('PUT', p, h) }
  delete(p, h) { return this.add('DELETE', p, h) }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = r.regex.exec(pathname)
      if (!m) continue
      const params = {}
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]) })
      return { handler: r.handler, params }
    }
    return null
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

export function sendError(res, e) {
  if (e instanceof PhError) {
    return sendJson(res, e.status, { code: e.code, message: e.message, hint: e.hint })
  }
  // 未预期异常：给前端一个稳定结构，细节留在服务端控制台
  console.error('[protohub] 未预期的服务端异常：', e)
  sendJson(res, 500, { code: 'INTERNAL_ERROR', message: '服务端异常，请查看运行 protohub 的终端' })
}

/** 请求体解析。带上限，避免一个手滑的大文件把本地进程撑爆。 */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new PhError('BODY_TOO_LARGE', `请求体超过上限 ${(maxBytes / 1024 / 1024).toFixed(0)}MB`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function readJson(req, maxBytes) {
  const buf = await readBody(req, maxBytes)
  if (buf.length === 0) return {}
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    throw new PhError('BAD_JSON', '请求体不是合法 JSON')
  }
}
