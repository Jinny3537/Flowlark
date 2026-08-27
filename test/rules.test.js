import { test, describe, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, html, throwsCode, cleanup } from './helpers.js'
import * as store from '../src/core/store.js'

const dirs = []
function fresh() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单中心重构', code: 'order-center' })
  return { root, hub, slug: 'order-center' }
}
after(() => dirs.forEach(cleanup))

const CHANGES = [
  { type: '新增', location: '订单列表-工具栏', content: '新增批量关闭按钮', requirement: 'REQ-0275' },
  { type: '修改', location: '订单列表-筛选区', content: '筛选区由两行压缩为一行' }
]

describe('项目', () => {
  test('创建与查询', (t) => {
    const { hub, slug } = fresh()
    const p = hub.getProject(slug)
    t.assert.strictEqual(p.name, '订单中心重构')
    t.assert.strictEqual(p.versionCount, 0)
    t.assert.strictEqual(p.baselineVersionNo, null)
  })

  test('项目标识重复被拦截', (t) => {
    const { hub } = fresh()
    throwsCode(t, 'PROJECT_EXISTS', () => hub.createProject({ name: '别的名字', code: 'order-center' }))
  })

  test('中文项目名自动生成的 slug 非法时明确报错，不静默生成怪名字', (t) => {
    const { hub } = fresh()
    throwsCode(t, 'CODE_INVALID', () => hub.createProject({ name: '纯中文项目名' }))
  })
})

describe('R1 状态派生', () => {
  test('新建版本是编辑中，成为基线后是基线，被顶替后是历史', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    t.assert.strictEqual(hub.getVersion(slug, 'v1.0').display.key, 'DRAFT')

    hub.setBaseline(slug, 'v1.0')
    t.assert.strictEqual(hub.getVersion(slug, 'v1.0').display.key, 'BASELINE')

    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html(), changes: CHANGES })
    hub.setBaseline(slug, 'v1.1')
    t.assert.strictEqual(hub.getVersion(slug, 'v1.0').display.key, 'HISTORY')
  })

  test('状态不落库：version.json 里没有 BASELINE 字段', (t) => {
    const { root, hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    const raw = JSON.parse(fs.readFileSync(store.paths.versionJson(root, slug, 'v1.0'), 'utf8'))
    t.assert.strictEqual(raw.status, 'READY', '落库状态只有 DRAFT/READY/VOID')
    t.assert.ok(!('display' in raw), '派生字段不该写进文件')
  })
})

describe('R2 单基线约束', () => {
  test('切换基线后有且仅有一个基线', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html(), changes: CHANGES })
    hub.setBaseline(slug, 'v1.1')

    const baselines = hub.listVersions(slug).filter((v) => v.isBaseline)
    t.assert.strictEqual(baselines.length, 1)
    t.assert.strictEqual(baselines[0].versionNo, 'v1.1')
  })

  test('基线由单个文件承载，物理上无法出现两个', (t) => {
    const { root, hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    const content = fs.readFileSync(store.paths.baselineFile(root, slug), 'utf8')
    t.assert.strictEqual(content, 'v1.0\n')
    t.assert.strictEqual(content.trim().split('\n').length, 1)
  })
})

describe('R3 回滚', () => {
  test('历史版本可回滚为基线', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html(), changes: CHANGES })
    hub.setBaseline(slug, 'v1.1')

    const v = hub.rollback(slug)
    t.assert.strictEqual(v.versionNo, 'v1.0')
    t.assert.strictEqual(hub.getVersion(slug, 'v1.1').display.key, 'HISTORY')
    t.assert.strictEqual(hub.listVersions(slug).filter((x) => x.isBaseline).length, 1)
  })

  test('回滚豁免 R6：首版当年没写变更日志，退回去时不该被卡住', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0') // 首版豁免，此时 changes 为空
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html(), changes: CHANGES })
    hub.setBaseline(slug, 'v1.1')

    // v1.0 依然没有变更日志，但它当过基线，回滚必须放行
    t.assert.strictEqual(hub.getVersion(slug, 'v1.0').changeCount, 0)
    const back = hub.setBaseline(slug, 'v1.0')
    t.assert.strictEqual(back.isBaseline, true)
  })

  test('没有历史基线时明确报错，不猜', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    throwsCode(t, 'NO_PREVIOUS_BASELINE', () => hub.rollback(slug))
  })
})

describe('R4 基线锁定与规格书豁免', () => {
  function baselined() {
    const ctx = fresh()
    ctx.hub.addVersion(ctx.slug, { versionNo: 'v1.0', title: '首版', html: html() })
    ctx.hub.setBaseline(ctx.slug, 'v1.0')
    return ctx
  }

  test('基线版本不可改标题', (t) => {
    const { hub, slug } = baselined()
    throwsCode(t, 'VERSION_LOCKED', () => hub.updateVersion(slug, 'v1.0', { title: '改名' }))
  })

  test('基线版本不可改变更日志', (t) => {
    const { hub, slug } = baselined()
    throwsCode(t, 'VERSION_LOCKED', () => hub.setChanges(slug, 'v1.0', CHANGES))
  })

  test('基线版本不可替换原型文件', (t) => {
    const { hub, slug } = baselined()
    throwsCode(t, 'VERSION_LOCKED', () => hub.replaceHtml(slug, 'v1.0', { html: html('新的') }))
  })

  test('规格书仍可编辑 —— 开发期补说明是常态，锁死会逼人发假版本', (t) => {
    const { root, hub, slug } = baselined()
    const v = hub.setSpec(slug, 'v1.0', '# 规格\n开发期补充')
    t.assert.match(v.spec, /开发期补充/)
    t.assert.ok(fs.existsSync(store.paths.versionSpec(root, slug, 'v1.0')), '规格书应落成独立 .spec.md')
  })
})

describe('R5 版本号', () => {
  test('同项目内重复被拦截', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    throwsCode(t, 'VERSION_EXISTS', () =>
      hub.addVersion(slug, { versionNo: 'v1.0', title: '撞号', html: html() }))
  })

  test('非法字符被拦截 —— 版本号即文件名，这是文件存储的代价', (t) => {
    const { hub, slug } = fresh()
    for (const bad of ['../etc', 'v1/2', '', '带空格 的']) {
      throwsCode(t, 'VERSION_NO_INVALID', () =>
        hub.addVersion(slug, { versionNo: bad, title: 'x', html: html() }))
    }
  })
})

describe('R6 变更日志必填', () => {
  test('项目首版豁免', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    const v = hub.setBaseline(slug, 'v1.0')
    t.assert.strictEqual(v.isBaseline, true)
  })

  test('非首版且从未当过基线时被拦截', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html() })
    throwsCode(t, 'CHANGELOG_REQUIRED', () => hub.setBaseline(slug, 'v1.1'))
  })

  test('补上变更日志后放行', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html() })
    hub.addChange(slug, 'v1.1', { type: '修改', location: '列表', content: '改了筛选' })
    t.assert.strictEqual(hub.setBaseline(slug, 'v1.1').isBaseline, true)
  })
})

describe('R7 逻辑删除', () => {
  test('删除后移入回收站，可恢复，版本号可复用', (t) => {
    const { root, hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html() })

    hub.removeVersion(slug, 'v1.1')
    t.assert.strictEqual(hub.listVersions(slug).length, 1)
    t.assert.strictEqual(hub.listTrash(slug).length, 1)

    // 主目录里看到的就是真实存在的版本，不需要每个查询都记得过滤 deleted 标记
    t.assert.ok(!fs.existsSync(store.paths.versionJson(root, slug, 'v1.1')))

    hub.addVersion(slug, { versionNo: 'v1.1', title: '复用号码', html: html() })
    t.assert.strictEqual(hub.getVersion(slug, 'v1.1').title, '复用号码')
  })

  test('号码被重新占用时拒绝恢复，而不是覆盖', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.removeVersion(slug, 'v1.0')
    hub.addVersion(slug, { versionNo: 'v1.0', title: '新的 v1.0', html: html() })
    throwsCode(t, 'VERSION_EXISTS', () => hub.restoreVersion(slug, 'v1.0'))
  })

  test('恢复后内容完整', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html('原始内容') })
    hub.setSpec(slug, 'v1.0', '# 规格')
    hub.removeVersion(slug, 'v1.0')
    const v = hub.restoreVersion(slug, 'v1.0')
    t.assert.strictEqual(v.title, '首版')
    t.assert.match(v.spec, /# 规格/)
  })

  test('同版本多次删除产生不同且可解析的回收站 ID', async (t) => {
    const { root, hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '第一次', html: html('one') })
    hub.removeVersion(slug, 'v1.0')
    const first = store.listTrash(root, slug)[0]

    await new Promise((resolve) => setTimeout(resolve, 2))
    hub.addVersion(slug, { versionNo: 'v1.0', title: '第二次', html: html('two') })
    hub.removeVersion(slug, 'v1.0')
    const entries = store.listTrash(root, slug)

    t.assert.strictEqual(entries.length, 2)
    t.assert.notStrictEqual(entries[0].id, entries[1].id)
    t.assert.strictEqual(store.readTrashEntry(root, first.id).dir, first.dir)
  })

  test('非法回收站 ID 不能越过 trash 根目录', (t) => {
    const { root } = fresh()
    throwsCode(t, 'TRASH_ID_INVALID', () => store.readTrashEntry(root, '../projects'))
    throwsCode(t, 'TRASH_ID_INVALID', () => store.readTrashEntry(root, 'not-base64'))
  })
})

describe('基线保护', () => {
  test('当前基线不可删除、不可废弃', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    throwsCode(t, 'BASELINE_PROTECTED', () => hub.removeVersion(slug, 'v1.0'))
    throwsCode(t, 'BASELINE_PROTECTED', () => hub.voidVersion(slug, 'v1.0'))
  })
})

describe('累计变更', () => {
  test('跨版本聚合并标出反复修改的热点', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.addVersion(slug, {
      versionNo: 'v1.1', title: '二版', html: html(),
      changes: [
        { type: '新增', location: '订单列表-工具栏', content: '批量关闭' },
        { type: '修改', location: '订单列表-筛选区', content: '压缩为一行' }
      ]
    })
    hub.addVersion(slug, {
      versionNo: 'v1.2', title: '三版', html: html(),
      changes: [
        { type: '修改', location: '订单列表-筛选区', content: '条件切页保留' },
        { type: '修改', location: '订单列表-筛选区', content: '增加更多筛选' },
        { type: '新增', location: '订单列表-表格', content: '表头排序' }
      ]
    })

    const r = hub.cumulative(slug, 'v1.0', 'v1.2')
    t.assert.strictEqual(r.versionCount, 2)
    t.assert.strictEqual(r.itemCount, 5)
    t.assert.strictEqual(r.locationCounts['订单列表-筛选区'], 3)
    t.assert.ok(r.items.every((i) => i.fromVersionNo), '每条变更都要标出来源版本')
  })
})

describe('外链检测', () => {
  test('识别 CDN 引用', (t) => {
    const { hub, slug } = fresh()
    const v = hub.addVersion(slug, {
      versionNo: 'v1.0', title: '带CDN',
      html: html('hi',
        '<script src="https://cdn.tailwindcss.com"></script>' +
        '<link href="https://fonts.googleapis.com/css" rel="stylesheet">')
    })
    t.assert.strictEqual(v.externalRefs.length, 2)
  })

  test('纯内联原型不误报', (t) => {
    const { hub, slug } = fresh()
    const v = hub.addVersion(slug, {
      versionNo: 'v1.0', title: '内联', html: html('hi', '<style>body{color:red}</style>')
    })
    t.assert.strictEqual(v.externalRefs.length, 0)
  })
})

describe('输入校验', () => {
  test('需求 URL 必须是 http(s)', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: 'x', html: html() })
    throwsCode(t, 'REQ_URL_INVALID', () =>
      hub.setRequirements(slug, 'v1.0', [{ code: 'REQ-1', url: 'ftp://x' }]))
  })

  test('变更类型非法被拦截，中英文别名都接受', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: 'x', html: html() })
    throwsCode(t, 'CHANGE_TYPE_INVALID', () =>
      hub.setChanges(slug, 'v1.0', [{ type: 'PATCH', content: 'x' }]))

    const v = hub.setChanges(slug, 'v1.0', [
      { type: '新增', content: 'a' }, { type: 'modify', content: 'b' }, { type: '删除', content: 'c' }
    ])
    t.assert.deepStrictEqual(v.changes.map((x) => x.type), ['ADD', 'MODIFY', 'REMOVE'])
  })

  test('空内容的变更条目被静默跳过，不打断录入', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: 'x', html: html() })
    const v = hub.setChanges(slug, 'v1.0', [
      { type: '修改', content: '有内容' }, { type: '修改', content: '   ' }, { type: '修改', content: '' }
    ])
    t.assert.strictEqual(v.changes.length, 1)
  })
})

describe('操作日志', () => {
  test('记录基线切换与回滚，且区分二者', (t) => {
    const { hub, slug } = fresh()
    hub.addVersion(slug, { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline(slug, 'v1.0')
    hub.addVersion(slug, { versionNo: 'v1.1', title: '二版', html: html(), changes: CHANGES })
    hub.setBaseline(slug, 'v1.1')
    hub.setBaseline(slug, 'v1.0')

    const actions = hub.oplog({ project: slug, limit: 50 }).map((e) => e.action)
    t.assert.ok(actions.includes('BASELINE_SET'))
    t.assert.ok(actions.includes('BASELINE_ROLLBACK'))
  })
})
