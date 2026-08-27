import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hub } from '../core/service.js'
import * as store from '../core/store.js'
import * as offline from '../core/offline.js'
import * as net from '../core/net.js'
import { startWecomMcpSidecar, unavailableWecomMcp } from '../core/wecom-mcp-manager.js'
import { buildApi } from './routes.js'
import { sendJson, sendError } from './router.js'

const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

function editablePreviewHtml(buf) {
  const bridge = `<script id="flowlark-edit-bridge">
(() => {
  const ALLOWED_COMMANDS = new Set([
    'bold', 'italic', 'underline', 'fontSize', 'foreColor',
    'justifyLeft', 'justifyCenter', 'justifyRight'
  ])
  const TEXT_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,span,a,li,button,label,td,th,dt,dd,figcaption,div'
  let savedRange = null
  let selectedTarget = null
  let stateFrame = 0

  const post = (payload) => window.parent.postMessage(payload, '*')
  const formatState = () => {
    try {
      return {
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        justifyLeft: document.queryCommandState('justifyLeft'),
        justifyCenter: document.queryCommandState('justifyCenter'),
        justifyRight: document.queryCommandState('justifyRight'),
        fontSize: document.queryCommandValue('fontSize'),
        foreColor: document.queryCommandValue('foreColor')
      }
    } catch {
      return {}
    }
  }
  const postState = () => {
    if (stateFrame) cancelAnimationFrame(stateFrame)
    stateFrame = requestAnimationFrame(() => {
      stateFrame = 0
      post({ type: 'flowlark:edit-state', state: formatState() })
    })
  }
  const markDirty = () => post({ type: 'flowlark:edit-dirty' })
  const rememberSelection = () => {
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount || !document.body || !document.body.contains(selection.anchorNode)) return
    savedRange = selection.getRangeAt(0).cloneRange()
  }
  const restoreSelection = () => {
    if (!savedRange) return
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(savedRange)
  }
  const restoreNode = (node, parent, next) => {
    if (!node || !parent) return
    parent.insertBefore(node, next && next.parentNode === parent ? next : null)
  }
  const serialize = () => {
    const bridge = document.getElementById('flowlark-edit-bridge')
    const style = document.getElementById('flowlark-edit-style')
    const bridgeParent = bridge && bridge.parentNode
    const bridgeNext = bridge && bridge.nextSibling
    const styleParent = style && style.parentNode
    const styleNext = style && style.nextSibling
    const targets = Array.from(document.querySelectorAll('[data-flowlark-edit-target]'))
    if (bridge) bridge.remove()
    if (style) style.remove()
    targets.forEach((node) => node.removeAttribute('data-flowlark-edit-target'))
    const previousEditable = document.body && document.body.getAttribute('contenteditable')
    const previousSpellcheck = document.body && document.body.getAttribute('spellcheck')
    if (document.body) document.body.removeAttribute('contenteditable')
    if (document.body) document.body.removeAttribute('spellcheck')
    const dt = document.doctype
    const doctype = dt ? '<!DOCTYPE ' + dt.name + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '') + (dt.systemId ? ' "' + dt.systemId + '"' : '') + '>' : '<!DOCTYPE html>'
    const html = doctype + '\\n' + document.documentElement.outerHTML
    if (document.body && previousEditable != null) document.body.setAttribute('contenteditable', previousEditable)
    if (document.body && previousSpellcheck != null) document.body.setAttribute('spellcheck', previousSpellcheck)
    targets.forEach((node) => node.setAttribute('data-flowlark-edit-target', ''))
    restoreNode(style, styleParent, styleNext)
    restoreNode(bridge, bridgeParent, bridgeNext)
    return html
  }
  const addEditorStyle = () => {
    if (document.getElementById('flowlark-edit-style')) return
    const style = document.createElement('style')
    style.id = 'flowlark-edit-style'
    style.textContent =
      ':where(h1,h2,h3,h4,h5,h6,p,span,a,li,button,label,td,th,dt,dd,figcaption,div):hover{' +
      'outline:1px dashed rgba(14,147,132,.55);outline-offset:2px;cursor:text}' +
      '[data-flowlark-edit-target]{outline:2px solid #0e9384!important;outline-offset:2px}'
    ;(document.head || document.documentElement).appendChild(style)
  }
  const markTarget = (event) => {
    const element = event.target instanceof Element ? event.target.closest(TEXT_SELECTOR) : null
    const next = element && element !== document.body && element.textContent && element.textContent.trim()
      ? element
      : null
    if (selectedTarget === next) return
    if (selectedTarget) selectedTarget.removeAttribute('data-flowlark-edit-target')
    selectedTarget = next
    if (selectedTarget) selectedTarget.setAttribute('data-flowlark-edit-target', '')
  }
  const enable = () => {
    try {
      addEditorStyle()
      document.designMode = 'on'
      if (document.body) {
        document.body.setAttribute('contenteditable', 'true')
        document.body.spellcheck = false
      }
      document.addEventListener('selectionchange', () => {
        rememberSelection()
        postState()
      })
      document.addEventListener('input', markDirty)
      document.addEventListener('pointerover', markTarget)
      document.addEventListener('click', markTarget)
      post({ type: 'flowlark:edit-ready', state: formatState() })
    } catch {}
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const data = event.data || {}
    if (data.type === 'flowlark:get-edit-html') {
      event.source.postMessage({ type: 'flowlark:edit-html', id: data.id, html: serialize() }, event.origin || '*')
      return
    }
    if (data.type !== 'flowlark:edit-command') return
    const command = String(data.command || '')
    if (!ALLOWED_COMMANDS.has(command)) {
      event.source.postMessage({ type: 'flowlark:edit-command-result', id: data.id, ok: false }, event.origin || '*')
      return
    }
    let ok = false
    try {
      restoreSelection()
      ok = document.execCommand(command, false, data.value == null ? null : String(data.value))
      rememberSelection()
      if (ok) markDirty()
    } catch {}
    event.source.postMessage({
      type: 'flowlark:edit-command-result',
      id: data.id,
      ok,
      state: formatState()
    }, event.origin || '*')
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enable, { once: true })
  else enable()
})()
</script>`
  const html = buf.toString('utf8')
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${bridge}</body>`)
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, `${bridge}</html>`)
  return `${html}\n${bridge}`
}

/**
 * 启动本地服务。
 *
 * 两个端口而不是一个：工作台在 port，原型预览在 previewPort。
 * 端口不同即不同源，浏览器的同源策略把原型里的脚本和工作台彻底隔开 ——
 * 原型可以随便跑 JS，但读不到工作台的 localStorage、发不出带凭据的请求。
 *
 * 开放局域网时，写操作按来源拦截：只有 127.0.0.1 能写。详见 core/net.js。
 */
export async function startServer(root, { port, previewPort, lan, host, mirror = false, wecomMcp = null, gitSync = null } = {}) {
  const hub = new Hub(root, { gitSync })
  const s = hub.settings
  let wecomRuntime = wecomMcp
  if (!wecomRuntime) {
    try {
      wecomRuntime = await startWecomMcpSidecar({ command: s.integrations.wecomCliCommand || 'wecom-cli' })
    } catch (error) {
      wecomRuntime = unavailableWecomMcp(error)
      console.error(`[flowlark] 企业微信 MCP Sidecar 未启动：${error.message}`)
    }
  }
  hub.attachWecomMcp(wecomRuntime)

  // 用 ?? 而不是 ||：端口 0 是「让内核分配一个空闲端口」的合法值，
  // 被当成假值忽略掉的话，调用方以为拿到了随机端口，实际却去抢固定端口。
  const mainPort = port ?? s.server.port
  const pvPort = previewPort ?? (port ? port + 1 : s.server.previewPort)
  const lanEnabled = lan !== undefined ? lan : s.server.lan
  const readonlyFromLan = s.server.readonlyFromLan
  const bind = host || net.bindHost(lanEnabled)

  // 0 表示各自随机分配，不算撞车
  if (mainPort !== 0 && mainPort === pvPort) {
    throw new Error(`工作台端口与预览端口不能相同（都是 ${mainPort}）—— 同源之后沙箱隔离就失效了`)
  }

  let api  // 在 previewServer 建好之后再构造，见下方说明

  const mainServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    try {
      // 主端口拒绝 /p/ —— 否则原型可以被同源加载，隔离就白做了
      if (url.pathname.startsWith('/p/')) {
        const a = previewServer.address()
        return sendJson(res, 404, {
          code: 'WRONG_PORT',
          message: `原型预览请走 ${a ? a.port : pvPort} 端口`
        })
      }

      // 局域网只读闸门。放在路由之前，避免任何一条新路由忘了加校验。
      if (net.shouldBlockWrite({
        lan: lanEnabled,
        readonlyFromLan,
        isLocal: net.isLocalRequest(req),
        method: req.method
      })) {
        return sendJson(res, 403, {
          code: 'READONLY_FROM_LAN',
          message: '局域网访问为只读模式，无法修改数据',
          hint: '请在运行 Flowlark 的那台机器上操作；或关闭只读保护（flowlark config server.readonlyFromLan false）'
        })
      }
      if (mirror && net.isWrite(req.method) && url.pathname !== '/api/mirror/refresh') {
        return sendJson(res, 403, { code: 'MIRROR_READONLY', message: '镜像模式永久只读，不能修改仓库数据' })
      }

      const hit = api.match(req.method, url.pathname)
      if (hit) return await hit.handler(req, res, hit.params, url)

      if (url.pathname.startsWith('/api/')) {
        return sendJson(res, 404, { code: 'NO_ROUTE', message: `没有这个接口：${url.pathname}` })
      }

      serveStatic(res, url.pathname)
    } catch (e) {
      sendError(res, e)
    }
  })

  const previewServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const m = /^\/p\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('此端口只提供原型文件：/p/<项目>/<版本号>')
    }
    const slug = decodeURIComponent(m[1])
    const no = decodeURIComponent(m[2])
    const wantOffline = url.searchParams.get('offline') === '1'
    const editMode = url.searchParams.get('edit') === '1'

    let buf = null
    try {
      buf = wantOffline ? offline.readOffline(root, slug, no) : null
      if (!buf) buf = store.readHtml(root, slug, no)
    } catch {
      buf = null
    }
    if (!buf) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(missingHtml(slug, no))
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    })
    res.end(editMode ? editablePreviewHtml(buf) : buf)
  })

  // previewPort 传 0 时真实端口要等 listen 之后才知道，所以用取值函数延迟解析，
  // 保证 health 下发的一定是浏览器能连上的那个端口。
  // 必须放在 previewServer 声明之后：buildApi 解构参数时会立刻求值。
  api = buildApi(hub, {
    previewPort: () => {
      const a = previewServer.address()
      return a ? a.port : pvPort
    },
    runtime: { lan: lanEnabled, readonlyFromLan, mirror }
  })

  await Promise.all([
    listen(mainServer, mainPort, bind, '工作台'),
    listen(previewServer, pvPort, bind, '预览服务')
  ])

  // 端口传 0 时内核才决定实际端口，要回填后再对外报告
  const actualPort = mainServer.address().port
  const actualPreviewPort = previewServer.address().port

  const close = () =>
    Promise.all([
      new Promise((r) => mainServer.close(r)),
      new Promise((r) => previewServer.close(r)),
      wecomRuntime.close()
    ])

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { close().then(() => process.exit(0)) })
  }

  const localHost = bind === '0.0.0.0' ? 'localhost' : bind
  const lanIp = lanEnabled ? net.primaryLanAddress() : null

  return {
    url: `http://${localHost}:${actualPort}`,
    previewUrl: `http://${localHost}:${actualPreviewPort}`,
    lanUrl: lanIp ? `http://${lanIp}:${actualPort}` : null,
    lanAddresses: lanEnabled ? net.lanAddresses() : [],
    lan: lanEnabled,
    readonlyFromLan,
    bind,
    wecomMcp: wecomRuntime.diagnostics(),
    port: actualPort,
    previewPort: actualPreviewPort,
    close
  }
}

function listen(server, port, host, label) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(new Error(
          `${label}端口 ${port} 已被占用。` +
          `可能是另一个 Flowlark 已在运行；换端口：flowlark serve --port ${port + 10}`
        ))
      } else if (e.code === 'EACCES') {
        reject(new Error(`${label}端口 ${port} 需要更高权限，换一个 1024 以上的端口`))
      } else reject(e)
    })
    server.listen(port, host, resolve)
  })
}

function serveStatic(res, pathname) {
  if (!fs.existsSync(WEB_DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(noWebHtml())
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let file = path.join(WEB_DIST, rel)

  // 纵深防御：任何越出 dist 的路径一律回落到首页
  if (!path.resolve(file).startsWith(path.resolve(WEB_DIST))) {
    file = path.join(WEB_DIST, 'index.html')
  }
  // hash 路由，未命中静态文件时交给前端处理
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(WEB_DIST, 'index.html')
  }
  const buf = fs.readFileSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': buf.length
  })
  res.end(buf)
}

function missingHtml(slug, no) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>文件缺失</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#fafafa;color:#8c8c8c;text-align:center;line-height:1.9}</style>
</head><body><div><div style="font-size:32px">📄</div>
<div style="font-size:15px;color:#595959;margin-top:8px">原型文件不存在</div>
<div style="font-size:13px">${escapeHtml(slug)} / ${escapeHtml(no)}</div>
<div style="font-size:12px;margin-top:8px">用 <code>flowlark ls ${escapeHtml(slug)}</code> 确认版本号</div>
</div></body></html>`
}

function noWebHtml() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>工作台未构建</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#fafafa;color:#595959;text-align:center;line-height:2}
code{background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:13px}</style>
</head><body><div><div style="font-size:32px">🛠️</div>
<div style="font-size:16px;margin-top:8px">浏览器工作台还没构建</div>
<div style="font-size:13px;color:#8c8c8c">在 Flowlark 源码目录执行 <code>npm run build:web</code></div>
<div style="font-size:13px;color:#8c8c8c">API 已经可用，CLI 的所有功能不受影响</div>
</div></body></html>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}
