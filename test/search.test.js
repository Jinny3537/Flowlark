import { test, describe, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, html, throwsCode, cleanup } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function seeded() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单中心重构', code: 'ord', description: '列表与详情改版' })
  hub.createProject({ name: '营销活动配置台', code: 'mkt' })

  hub.addVersion('ord', { versionNo: 'v1.0', title: '首版原型', html: html() })
  hub.setBaseline('ord', 'v1.0')
  hub.addVersion('ord', {
    versionNo: 'v1.1', title: '批量操作首版', html: html(),
    changes: [
      { type: '新增', location: '订单列表-工具栏', content: '新增批量关闭按钮', requirement: 'REQ-0275' },
      { type: '修改', location: '订单列表-筛选区', content: '筛选区由两行压缩为一行' }
    ],
    requirements: [{ code: 'REQ-0301', title: '物流轨迹时间线', url: 'https://example.com/REQ-0301' }],
    tags: ['已评审']
  })
  hub.setSpec('ord', 'v1.1', '# 批量导出\n\n单次上限待确认，需研发评估幂等策略。')
  hub.addVersion('mkt', { versionNo: 'v2.0', title: '满减配置', html: html() })
  return { root, hub }
}

describe('全局搜索', () => {
  test('搜规格书正文', (t) => {
    const { hub } = seeded()
    const r = hub.search('幂等')
    t.assert.strictEqual(r.total, 1)
    t.assert.strictEqual(r.results[0].field, 'spec')
    t.assert.strictEqual(r.results[0].versionNo, 'v1.1')
  })

  test('变更日志里写的需求号也能搜到', (t) => {
    // 用户用 -m "…:REQ-0275" 写进变更日志后，自然会期待搜得到，
    // 哪怕它没被单独登记进关联需求列表
    const { hub } = seeded()
    const r = hub.search('REQ-0275')
    t.assert.ok(r.total >= 1, '应能搜到')
    t.assert.strictEqual(r.results[0].field, 'change')
  })

  test('关联需求列表里的编号能搜到', (t) => {
    const { hub } = seeded()
    const r = hub.search('REQ-0301')
    t.assert.ok(r.results.some((x) => x.field === 'requirement'))
  })

  test('标签可搜', (t) => {
    const { hub } = seeded()
    const r = hub.search('已评审')
    t.assert.ok(r.results.some((x) => x.field === 'tag'))
  })

  test('版本号精确命中排在最前', (t) => {
    const { hub } = seeded()
    const r = hub.search('v1.1')
    t.assert.strictEqual(r.results[0].field, 'versionNo')
  })

  test('同分时基线优先', (t) => {
    const { hub } = seeded()
    // 两个版本标题里都有「版」，v1.0 是基线
    const r = hub.search('版')
    const titleHits = r.results.filter((x) => x.field === 'title' && x.project === 'ord')
    t.assert.ok(titleHits.length >= 2)
    t.assert.strictEqual(titleHits[0].versionStatus, 'BASELINE', '基线应排在同分结果的前面')
  })

  test('可限定字段与项目', (t) => {
    const { hub } = seeded()
    t.assert.strictEqual(hub.search('幂等', { fields: ['title'] }).total, 0)
    t.assert.strictEqual(hub.search('配置', { project: 'ord' }).total, 0)
    t.assert.ok(hub.search('配置', { project: 'mkt' }).total > 0)
  })

  test('片段带命中位置，供上层高亮', (t) => {
    const { hub } = seeded()
    const s = hub.search('幂等').results[0].snippet
    t.assert.strictEqual(s.text.substr(s.matchStart, s.matchLength), '幂等')
  })

  test('空查询返回空，不报错', (t) => {
    const { hub } = seeded()
    t.assert.strictEqual(hub.search('   ').total, 0)
  })

  test('空关键词可以按需求结构化筛选', (t) => {
    const { hub } = seeded()
    const result = hub.search('', { filters: { requirement: 'REQ-0301' } })
    t.assert.strictEqual(result.total, 1)
    t.assert.strictEqual(result.results[0].versionNo, 'v1.1')
  })
})

describe('版本标签', () => {
  test('增删查与全库统计', (t) => {
    const { hub } = seeded()
    hub.addTag('ord', 'v1.1', '待交付')
    t.assert.deepStrictEqual(hub.getVersion('ord', 'v1.1').tags, ['已评审', '待交付'])

    hub.removeTag('ord', 'v1.1', '已评审')
    t.assert.deepStrictEqual(hub.getVersion('ord', 'v1.1').tags, ['待交付'])

    t.assert.deepStrictEqual(hub.allTags(), [{ tag: '待交付', count: 1 }])
  })

  test('去重并规范化', (t) => {
    const { hub } = seeded()
    const v = hub.setTags('ord', 'v1.1', ['a', 'a', ' a ', 'b'])
    t.assert.deepStrictEqual(v.tags, ['a', 'b'])
  })

  test('标签不受基线锁定影响', (t) => {
    // v1.0 是基线，改标题会被拒；但标签是事后追加的组织信息，应该放行
    const { hub } = seeded()
    throwsCode(t, 'VERSION_LOCKED', () => hub.updateVersion('ord', 'v1.0', { title: 'x' }))
    const v = hub.setTags('ord', 'v1.0', ['已交付'])
    t.assert.deepStrictEqual(v.tags, ['已交付'])
  })

  test('标签写进 JSON 且键序稳定', (t) => {
    const { root, hub } = seeded()
    hub.setTags('ord', 'v1.0', ['已交付'])
    const text = fs.readFileSync(path.join(root, 'projects/ord/versions/v1.0.json'), 'utf8')
    const keys = [...text.matchAll(/^ {2}"([a-zA-Z]+)"/gm)].map((m) => m[1])
    t.assert.deepStrictEqual(keys.slice(0, 6), ['versionNo', 'title', 'status', 'reviewStatus', 'note', 'tags'])
  })
})

describe('已读标记', () => {
  test('标记后新版本被标为「新」', (t) => {
    const { hub } = seeded()
    hub.markRead('ord', 'v1.0')
    const list = hub.listVersions('ord')
    t.assert.strictEqual(list.find((v) => v.versionNo === 'v1.1').isNew, true)
    t.assert.strictEqual(list.find((v) => v.versionNo === 'v1.0').isNew, false)
    t.assert.strictEqual(list.find((v) => v.versionNo === 'v1.0').isLastRead, true)
  })

  test('从未标记时不给任何版本打「新」', (t) => {
    // 全部标新等于没标
    const { hub } = seeded()
    t.assert.ok(hub.listVersions('ord').every((v) => !v.isNew))
  })

  test('sinceLastRead 的口径与「新」标记一致', (t) => {
    // 曾经的 bug：sinceLastRead 用基线做终点，而新版本还是草稿，
    // 于是 read 说「新增了 1 个版本」，diff 却说「0 条变更」
    const { hub } = seeded()
    hub.markRead('ord', 'v1.0')

    const newCount = hub.listVersions('ord').filter((v) => v.isNew).length
    const r = hub.sinceLastRead('ord')

    t.assert.strictEqual(newCount, 1)
    t.assert.strictEqual(r.versionCount, 1, '两处口径必须一致')
    t.assert.strictEqual(r.itemCount, 2)
    t.assert.strictEqual(r.basedOnReadState, true)
    t.assert.strictEqual(r.lastReadVersionNo, 'v1.0')
  })

  test('没有已读记录时退化为「比上一版改了什么」', (t) => {
    const { hub } = seeded()
    const r = hub.sinceLastRead('ord')
    t.assert.strictEqual(r.basedOnReadState, false)
    t.assert.strictEqual(r.fromVersionNo, 'v1.0')
  })

  test('已读状态存在 cache 目录，且被 .gitignore 忽略', (t) => {
    // 已读是每个人自己的，提交上去会变成「张三把李四标成已读」这种荒唐冲突
    const { root, hub } = seeded()
    hub.markRead('ord', 'v1.0')
    t.assert.ok(fs.existsSync(path.join(root, '.flowlark/cache/read-state.json')))
    t.assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.flowlark\/cache\//)
  })

  test('清除标记', (t) => {
    const { hub } = seeded()
    hub.markRead('ord', 'v1.0')
    hub.clearRead('ord')
    t.assert.strictEqual(hub.getRead('ord'), null)
  })

  test('标记不存在的版本会报错', (t) => {
    const { hub } = seeded()
    throwsCode(t, 'NOT_FOUND', () => hub.markRead('ord', 'v9.9'))
  })
})
