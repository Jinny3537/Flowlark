import { test, describe, before, after } from 'node:test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, cleanup } from './helpers.js'

/**
 * 离线版本生成。用一个本地 HTTP 服务扮演 CDN —— 这样能真的走完
 * 下载、内联、失败降级的全流程，而不是 mock 掉 fetch 假装测过。
 */

let cdn, base
const dirs = []

before(async () => {
  cdn = http.createServer((req, res) => {
    if (req.url === '/lib.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' })
      // 故意带上 </script>：内联时不转义会提前闭合标签，把页面搞坏
      return res.end('console.log("cdn script"); // 注意这里有 </script> 字样')
    }
    if (req.url === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' })
      return res.end('body{background:#eef}')
    }
    if (req.url === '/logo.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(Buffer.from('89504e470d0a1a0a', 'hex'))
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise((r) => cdn.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${cdn.address().port}`
})

after(() => {
  if (cdn) cdn.close()
  dirs.forEach(cleanup)
})

function repo() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '离线测试', code: 'off' })
  return { root, hub }
}

describe('离线版本生成', () => {
  test('抓取并内联 CDN 资源', async (t) => {
    const { hub } = repo()
    const v = hub.addVersion('off', {
      versionNo: 'v1.0',
      title: '带 CDN',
      html: `<!DOCTYPE html><html><head>
        <script src="${base}/lib.js"></script>
        <link rel="stylesheet" href="${base}/style.css">
        </head><body><img src="${base}/logo.png"></body></html>`
    })
    t.assert.strictEqual(v.externalRefs.length, 3)

    const r = await hub.buildOffline('off', 'v1.0')
    t.assert.strictEqual(r.total, 3)
    t.assert.strictEqual(r.inlined, 3)
    t.assert.strictEqual(r.ok, true)

    const out = hub.readOffline('off', 'v1.0').toString('utf8')
    t.assert.match(out, /cdn script/, '脚本应被内联')
    t.assert.match(out, /background:#eef/, 'CSS 应被内联')
    t.assert.match(out, /data:image\/png;base64/, '图片应转为 data URI')
    t.assert.ok(!out.includes(`${base}/lib.js`), '不该再有外链')
  })

  test('内联脚本里的 </script> 必须转义，否则页面会被截断', async (t) => {
    const { hub } = repo()
    hub.addVersion('off', {
      versionNo: 'v1.0', title: 'x',
      html: `<html><head><script src="${base}/lib.js"></script></head><body>正文</body></html>`
    })
    await hub.buildOffline('off', 'v1.0')
    const out = hub.readOffline('off', 'v1.0').toString('utf8')
    t.assert.match(out, /<\\\/script>/, '应转义为 <\\/script>')
    t.assert.match(out, /正文/, '正文不该被截断')
  })

  test('抓取失败的资源保持原样并如实报告', async (t) => {
    const { hub } = repo()
    hub.addVersion('off', {
      versionNo: 'v1.0', title: 'x',
      html: `<html><head><script src="${base}/missing.js"></script>
        <link rel="stylesheet" href="${base}/style.css"></head><body></body></html>`
    })
    const r = await hub.buildOffline('off', 'v1.0')
    t.assert.strictEqual(r.ok, false)
    t.assert.strictEqual(r.inlined, 1)
    t.assert.strictEqual(r.failed.length, 1)
    t.assert.match(r.failed[0].reason, /404/)

    const out = hub.readOffline('off', 'v1.0').toString('utf8')
    t.assert.ok(out.includes(`${base}/missing.js`), '失败的资源应保持原链接')
  })

  test('不修改原型文件本身 —— 它是需求追溯的证据', async (t) => {
    const { root, hub } = repo()
    const original = `<html><head><script src="${base}/lib.js"></script></head><body>原始</body></html>`
    hub.addVersion('off', { versionNo: 'v1.0', title: 'x', html: original })
    await hub.buildOffline('off', 'v1.0')

    const onDisk = fs.readFileSync(path.join(root, 'projects/off/versions/v1.0.html'), 'utf8')
    t.assert.strictEqual(onDisk, original, '原型文件必须一字不改')
  })

  test('产物落在 cache 目录，不进 Git', async (t) => {
    const { root, hub } = repo()
    hub.addVersion('off', { versionNo: 'v1.0', title: 'x', html: `<html><body>x</body></html>` })
    const r = await hub.buildOffline('off', 'v1.0')
    t.assert.match(r.file, /\.protohub[/\\]cache[/\\]offline/)
    t.assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.protohub\/cache\//)
  })

  test('基线版本也能生成离线版（因为不违反不可变性）', async (t) => {
    const { hub } = repo()
    hub.addVersion('off', {
      versionNo: 'v1.0', title: 'x',
      html: `<html><head><link rel="stylesheet" href="${base}/style.css"></head><body></body></html>`
    })
    hub.setBaseline('off', 'v1.0')
    const r = await hub.buildOffline('off', 'v1.0')
    t.assert.strictEqual(r.inlined, 1)
    t.assert.strictEqual(hub.getVersion('off', 'v1.0').hasOffline, true)
  })

  test('本来就自包含的原型直接拷贝', async (t) => {
    const { hub } = repo()
    hub.addVersion('off', { versionNo: 'v2.0', title: '纯内联', html: '<html><body>hi</body></html>' })
    const r = await hub.buildOffline('off', 'v2.0')
    t.assert.strictEqual(r.alreadySelfContained, true)
    t.assert.strictEqual(r.total, 0)
  })

  test('可以删除离线版', async (t) => {
    const { hub } = repo()
    hub.addVersion('off', { versionNo: 'v1.0', title: 'x', html: '<html><body>x</body></html>' })
    await hub.buildOffline('off', 'v1.0')
    t.assert.strictEqual(hub.hasOffline('off', 'v1.0'), true)
    hub.clearOffline('off', 'v1.0')
    t.assert.strictEqual(hub.hasOffline('off', 'v1.0'), false)
  })
})
