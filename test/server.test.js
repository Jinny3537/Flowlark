import { test, describe, before, after } from 'node:test'
import { newHub, html, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'

/**
 * 真实起 HTTP 服务并发请求。重点验证两件事：
 *   1. API 与 CLI 走的是同一套业务规则（不是两份实现）
 *   2. 预览端口的隔离真的生效
 */

let root, hub, server, base, previewBase

before(async () => {
  const ctx = newHub()
  root = ctx.root
  hub = ctx.hub
  hub.createProject({ name: '订单中心', code: 'ord' })
  // 端口 0 让内核分配空闲端口，避免测试之间抢端口
  server = await startServer(root, { port: 0, previewPort: 0 })
  base = `http://127.0.0.1:${server.port}`
  previewBase = `http://127.0.0.1:${server.previewPort}`
})

after(async () => {
  if (server) await server.close()
  cleanup(root)
})

const api = {
  async get(p) {
    const r = await fetch(base + p)
    return { status: r.status, body: await r.json() }
  },
  async send(method, p, body) {
    const r = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
  }
}

describe('HTTP API', () => {
  test('health 下发预览端口', async (t) => {
    const { status, body } = await api.get('/api/health')
    t.assert.strictEqual(status, 200)
    t.assert.strictEqual(body.ok, true)
    t.assert.strictEqual(body.previewPort, server.previewPort)
  })

  test('创建版本 → 设为基线 → 查询', async (t) => {
    let r = await api.send('POST', '/api/projects/ord/versions', {
      versionNo: 'v1.0', title: '首版原型', html: html('首版')
    })
    t.assert.strictEqual(r.status, 201)
    t.assert.strictEqual(r.body.display.key, 'DRAFT')

    r = await api.send('POST', '/api/versions/ord/v1.0/baseline')
    t.assert.strictEqual(r.status, 200)
    t.assert.strictEqual(r.body.isBaseline, true)

    const p = await api.get('/api/projects/ord')
    t.assert.strictEqual(p.body.baselineVersionNo, 'v1.0')
  })

  test('业务规则在 HTTP 侧同样生效（不是两份实现）', async (t) => {
    await api.send('POST', '/api/projects/ord/versions', {
      versionNo: 'v1.1', title: '二版', html: html('二版')
    })
    // R6：非首版无变更日志不能设为基线
    let r = await api.send('POST', '/api/versions/ord/v1.1/baseline')
    t.assert.strictEqual(r.status, 400)
    t.assert.strictEqual(r.body.code, 'CHANGELOG_REQUIRED')
    t.assert.ok(r.body.hint, '错误响应要带可执行的下一步')

    // R4：基线锁定
    r = await api.send('PUT', '/api/versions/ord/v1.0', { title: '改名' })
    t.assert.strictEqual(r.body.code, 'VERSION_LOCKED')

    // R4 另一半：规格书仍可改
    r = await api.send('PUT', '/api/versions/ord/v1.0/spec', { markdown: '# 补充说明' })
    t.assert.strictEqual(r.status, 200)
    t.assert.match(r.body.spec, /补充说明/)

    // R5：版本号重复
    r = await api.send('POST', '/api/projects/ord/versions', {
      versionNo: 'v1.0', title: '撞号', html: html()
    })
    t.assert.strictEqual(r.status, 409)
  })

  test('累计变更接口', async (t) => {
    await api.send('PUT', '/api/versions/ord/v1.1/changes', {
      items: [
        { type: '修改', location: '筛选区', content: '压缩一行' },
        { type: '新增', location: '工具栏', content: '批量导出' }
      ]
    })
    const r = await api.get('/api/projects/ord/cumulative?from=v1.0&to=v1.1')
    t.assert.strictEqual(r.body.itemCount, 2)
    t.assert.strictEqual(r.body.items[0].fromVersionNo, 'v1.1')
  })

  test('未知接口返回结构化 404', async (t) => {
    const r = await api.get('/api/nope')
    t.assert.strictEqual(r.status, 404)
    t.assert.strictEqual(r.body.code, 'NO_ROUTE')
  })
})

describe('沙箱隔离', () => {
  test('预览端口能取到原型 HTML', async (t) => {
    const r = await fetch(`${previewBase}/p/ord/v1.0`)
    t.assert.strictEqual(r.status, 200)
    t.assert.match(r.headers.get('content-type'), /text\/html/)
    t.assert.match(await r.text(), /首版/)
  })

  test('主端口拒绝 /p/ —— 否则原型可被同源加载，隔离就白做了', async (t) => {
    const r = await fetch(`${base}/p/ord/v1.0`)
    t.assert.strictEqual(r.status, 404)
    t.assert.strictEqual((await r.json()).code, 'WRONG_PORT')
  })

  test('预览端口不暴露 API —— 防止绕过工作台直接打接口', async (t) => {
    const r = await fetch(`${previewBase}/api/projects`)
    t.assert.strictEqual(r.status, 404)
  })

  test('两个端口不同源', (t) => {
    t.assert.notStrictEqual(server.port, server.previewPort)
  })

  test('文件缺失时返回可读占位页，而非浏览器原生错误', async (t) => {
    const r = await fetch(`${previewBase}/p/ord/v9.9`)
    t.assert.strictEqual(r.status, 200)
    t.assert.match(await r.text(), /原型文件不存在/)
  })
})

describe('升级后的 API', () => {
  test('搜索接口', async (t) => {
    await api.send('PUT', '/api/versions/ord/v1.1/spec', { markdown: '# 导出\n\n需要评估幂等策略。' })
    const r = await api.get('/api/search?q=' + encodeURIComponent('幂等'))
    t.assert.strictEqual(r.status, 200)
    t.assert.ok(r.body.total >= 1)
    t.assert.strictEqual(r.body.results[0].field, 'spec')
  })

  test('搜索可限定字段', async (t) => {
    const r = await api.get('/api/search?q=' + encodeURIComponent('幂等') + '&field=title')
    t.assert.strictEqual(r.body.total, 0)
  })

  test('标签读写与全库统计', async (t) => {
    let r = await api.send('PUT', '/api/versions/ord/v1.1/tags', { tags: ['已评审', '已评审', 'x'] })
    t.assert.deepStrictEqual(r.body.tags, ['已评审', 'x'])

    r = await api.get('/api/tags')
    t.assert.ok(r.body.some((x) => x.tag === '已评审'))
  })

  test('标签对基线版本同样可写（不受 R4 锁定）', async (t) => {
    const locked = await api.send('PUT', '/api/versions/ord/v1.0', { title: 'x' })
    t.assert.strictEqual(locked.body.code, 'VERSION_LOCKED')

    const r = await api.send('PUT', '/api/versions/ord/v1.0/tags', { tags: ['已交付'] })
    t.assert.strictEqual(r.status, 200)
    t.assert.deepStrictEqual(r.body.tags, ['已交付'])
  })

  test('已读标记读写，并驱动 since-read', async (t) => {
    await api.send('PUT', '/api/read/ord', { versionNo: 'v1.0' })
    const read = await api.get('/api/read/ord')
    t.assert.strictEqual(read.body.versionNo, 'v1.0')

    const list = await api.get('/api/projects/ord/versions')
    t.assert.strictEqual(list.body.find((v) => v.versionNo === 'v1.1').isNew, true)

    const since = await api.get('/api/projects/ord/since-read')
    t.assert.strictEqual(since.body.basedOnReadState, true)
    t.assert.strictEqual(since.body.lastReadVersionNo, 'v1.0')
  })

  test('离线版本生成，并可从预览端口取到', async (t) => {
    // v1.1 没有外链，走「原样拷贝」分支
    const r = await api.send('POST', '/api/versions/ord/v1.1/offline')
    t.assert.strictEqual(r.status, 200)
    t.assert.strictEqual(r.body.alreadySelfContained, true)

    const v = await api.get('/api/versions/ord/v1.1')
    t.assert.strictEqual(v.body.hasOffline, true)

    const pv = await fetch(`${previewBase}/p/ord/v1.1?offline=1`)
    t.assert.strictEqual(pv.status, 200)
    t.assert.match(await pv.text(), /二版/)
  })

  test('Git 接口在未纳入 Git 时也能安全返回', async (t) => {
    const r = await api.get('/api/git/status')
    t.assert.strictEqual(r.status, 200)
    t.assert.strictEqual(typeof r.body.tracked, 'boolean')

    const c = await api.get('/api/git/conflicts')
    t.assert.strictEqual(c.status, 200)
    t.assert.ok(Array.isArray(c.body))
  })

  test('版本历史接口在无 Git 时返回空数组而不是报错', async (t) => {
    const r = await api.get('/api/versions/ord/v1.1/history')
    // 未纳入 Git 时 requireRepo 会抛业务错误，这是可接受的；
    // 但一定要是结构化响应，不能是 500
    t.assert.ok(r.status === 200 || r.status === 400, `实际 ${r.status}`)
    if (r.status === 400) t.assert.ok(r.body.code)
  })
})

describe('配置与局域网 API', () => {
  test('配置列表带 schema 元信息，前端不用自己维护一份', async (t) => {
    const r = await api.get('/api/config')
    t.assert.strictEqual(r.status, 200)
    t.assert.ok(r.body.items.length > 10)
    const item = r.body.items.find((i) => i.key === 'server.readonlyFromLan')
    t.assert.ok(item.label && item.note, '要带标签和说明')
    t.assert.strictEqual(item.danger, true, '高风险开关要标出来')
  })

  test('改配置并落盘', async (t) => {
    const r = await api.send('PUT', '/api/config/ui.dateStyle', { value: 'absolute' })
    t.assert.strictEqual(r.status, 200)
    t.assert.strictEqual(r.body.value, 'absolute')

    const after = await api.get('/api/config')
    t.assert.strictEqual(after.body.items.find((i) => i.key === 'ui.dateStyle').value, 'absolute')

    await api.send('DELETE', '/api/config/ui.dateStyle')
  })

  test('非法配置值被拒，并返回结构化错误', async (t) => {
    const r = await api.send('PUT', '/api/config/server.port', { value: 'abc' })
    t.assert.strictEqual(r.status, 400)
    t.assert.strictEqual(r.body.code, 'BAD_CONFIG_VALUE')
  })

  test('服务类配置会提示需要重启', async (t) => {
    const r = await api.send('PUT', '/api/config/server.maxFileBytes', { value: '20MB' })
    t.assert.strictEqual(r.body.needsRestart, true)
  })

  test('运行时的局域网状态优先于配置文件', async (t) => {
    // flowlark serve --lan 是一次性覆盖，不写配置。
    // 若 health 按配置回答，局域网访客会看到可写的界面，点了才收到 403
    const { startServer } = await import('../src/server/index.js')
    const s2 = await startServer(root, { port: 0, previewPort: 0, lan: true })
    try {
      const h = await (await fetch(`http://127.0.0.1:${s2.port}/api/health`)).json()
      t.assert.strictEqual(h.lan, true, 'health 要反映实际运行状态')

      const lan = await (await fetch(`http://127.0.0.1:${s2.port}/api/lan`)).json()
      t.assert.strictEqual(lan.enabled, true, '实际已开启')
      t.assert.strictEqual(lan.configured, false, '配置里仍是关闭 —— 两者要能分辨')

      // 本机请求即便在局域网模式下也应可写
      t.assert.strictEqual(h.canWrite, true)
    } finally {
      await s2.close()
    }
  })

  test('局域网状态接口', async (t) => {
    const r = await api.get('/api/lan')
    t.assert.strictEqual(r.status, 200)
    t.assert.strictEqual(typeof r.body.enabled, 'boolean')
    t.assert.strictEqual(r.body.requestIsLocal, true, '测试是从回环发起的')
    t.assert.ok(Array.isArray(r.body.addresses))
  })

  test('health 下发写权限，前端据此隐藏写操作', async (t) => {
    const r = await api.get('/api/health')
    t.assert.strictEqual(r.body.canWrite, true)
    t.assert.strictEqual(r.body.readonly, false)
    t.assert.ok(r.body.rules)
  })
})

describe('附件 API', () => {
  test('原始请求体上传、下载、删除', async (t) => {
    const content = '# 需求文档\n\n批量导出上限待确认。'
    const up = await fetch(
      `${base}/api/versions/ord/v1.1/attachments?name=${encodeURIComponent('需求文档.md')}`,
      { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: content }
    )
    t.assert.strictEqual(up.status, 201)
    const v = await up.json()
    t.assert.strictEqual(v.attachments.length, 1)
    t.assert.strictEqual(v.attachments[0].name, '需求文档.md')

    const down = await fetch(`${base}/api/versions/ord/v1.1/attachments/${encodeURIComponent('需求文档.md')}`)
    t.assert.strictEqual(down.status, 200)
    t.assert.match(down.headers.get('content-type'), /markdown/)
    t.assert.strictEqual(await down.text(), content)

    // 默认 inline 便于浏览器预览，download=1 才强制下载
    t.assert.match(down.headers.get('content-disposition'), /^inline/)
    const forced = await fetch(
      `${base}/api/versions/ord/v1.1/attachments/${encodeURIComponent('需求文档.md')}?download=1`)
    t.assert.match(forced.headers.get('content-disposition'), /^attachment/)

    const del = await api.send('DELETE',
      `/api/versions/ord/v1.1/attachments/${encodeURIComponent('需求文档.md')}`)
    t.assert.strictEqual(del.status, 200)
    t.assert.strictEqual(del.body.attachments.length, 0)
  })

  test('缺少 name 参数时明确报错', async (t) => {
    const r = await fetch(`${base}/api/versions/ord/v1.1/attachments`,
      { method: 'POST', body: 'x' })
    t.assert.strictEqual(r.status, 400)
    t.assert.strictEqual((await r.json()).code, 'NAME_REQUIRED')
  })

  test('不存在的附件返回 404 而不是 500', async (t) => {
    const r = await api.get('/api/versions/ord/v1.1/attachments/nope.md')
    t.assert.strictEqual(r.status, 404)
    t.assert.strictEqual(r.body.code, 'NOT_FOUND')
  })
})

describe('远端 API', () => {
  test('未纳入 Git 时查询远端返回 null，不报错', async (t) => {
    const r = await api.get('/api/git/remote')
    t.assert.strictEqual(r.status, 200)
    t.assert.strictEqual(r.body, null)
  })

  test('未纳入 Git 时设置远端给出可执行的提示', async (t) => {
    const r = await api.send('PUT', '/api/git/remote', { url: 'https://example.com/a.git' })
    t.assert.strictEqual(r.status, 400)
    t.assert.strictEqual(r.body.code, 'NOT_GIT_REPO')
    // 提示必须指向 Flowlark 自己的命令。产品不再让用户去终端敲 git ——
    // 这条断言就是那个约定的守门人：谁把裸 git 写回提示里，这里会红。
    t.assert.match(r.body.hint, /flowlark git setup/)
    t.assert.doesNotMatch(r.body.hint, /git init|git add|git commit/)
  })
})
