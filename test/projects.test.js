import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import { cleanup, html, newHub, throwsCode } from './helpers.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture() {
  const { root, hub } = newHub()
  dirs.push(root)
  const project = hub.createProject({
    name: '华油中蓝', code: 'HYZL', description: '安全生产原型', priority: 'P1', archived: false
  })
  return { root, hub, project }
}

describe('项目可编辑字段', () => {
  test('创建项目保存优先级与归档状态', (t) => {
    const { project } = fixture()
    t.assert.strictEqual(project.code, 'HYZL')
    t.assert.strictEqual(project.priority, 'P1')
    t.assert.strictEqual(project.archived, false)
  })

  test('编辑业务代码不改变 slug、目录和历史链接', (t) => {
    const { root, hub, project } = fixture()
    const beforeDir = store.paths.project(root, project.slug)
    const updated = hub.updateProject(project.slug, {
      name: '华油中蓝二期', code: 'HYZL2', description: '二期范围', priority: 'P0', archived: true
    })
    t.assert.strictEqual(updated.slug, 'hyzl')
    t.assert.strictEqual(updated.code, 'HYZL2')
    t.assert.strictEqual(updated.name, '华油中蓝二期')
    t.assert.strictEqual(updated.description, '二期范围')
    t.assert.strictEqual(updated.priority, 'P0')
    t.assert.strictEqual(updated.archived, true)
    t.assert.strictEqual(store.paths.project(root, updated.slug), beforeDir)
    t.assert.strictEqual(fs.existsSync(beforeDir), true)
  })

  test('创建项目不能复用其他项目编辑后的业务代码', (t) => {
    const { hub, project } = fixture()
    hub.updateProject(project.slug, { code: 'NEWCODE' })
    throwsCode(t, 'PROJECT_CODE_EXISTS', () => hub.createProject({ name: '新项目', code: 'NEWCODE' }))
  })

  test('非法字段和重复业务代码不写入项目文件', (t) => {
    const { root, hub, project } = fixture()
    hub.createProject({ name: '其他项目', code: 'OTHER' })
    const file = store.paths.projectFile(root, project.slug)
    const before = fs.readFileSync(file, 'utf8')
    throwsCode(t, 'NAME_REQUIRED', () => hub.updateProject(project.slug, { name: '   ' }))
    throwsCode(t, 'PROJECT_CODE_INVALID', () => hub.updateProject(project.slug, { code: 'bad-code' }))
    throwsCode(t, 'PROJECT_CODE_EXISTS', () => hub.updateProject(project.slug, { code: 'OTHER' }))
    throwsCode(t, 'PROJECT_PRIORITY_INVALID', () => hub.updateProject(project.slug, { priority: 'urgent' }))
    throwsCode(t, 'PROJECT_ARCHIVED_INVALID', () => hub.updateProject(project.slug, { archived: 'true' }))
    t.assert.strictEqual(fs.readFileSync(file, 'utf8'), before)
  })

  test('历史非标准代码未修改时仍可编辑其他字段', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const legacy = hub.createProject({ name: '旧项目', code: 'legacy-code' })
    const updated = hub.updateProject(legacy.slug, { description: '保留旧代码', priority: 'P2' })
    t.assert.strictEqual(updated.code, 'legacy-code')
    t.assert.strictEqual(updated.description, '保留旧代码')
    t.assert.strictEqual(updated.priority, 'P2')
    t.assert.strictEqual(updated.archived, false)
  })
})

describe('项目概览派生统计', () => {
  test('按字段或版本关联归属并按需求编号去重', (t) => {
    const { hub, project } = fixture()
    hub.createRequirement({ code: 'REQ-1', title: '代码匹配且关联版本', project: 'HYZL', dueDate: '2000-01-01' })
    hub.createRequirement({ code: 'REQ-2', title: '名称匹配', project: '华油中蓝', dueDate: '2999-01-01' })
    hub.createRequirement({ code: 'REQ-3', title: '其他项目', project: 'OTHER', dueDate: '2000-01-01' })
    hub.addVersion(project.slug, {
      versionNo: 'v1', title: '首版', html: html(), requirements: ['REQ-1']
    })
    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.requirementCount, 2)
    t.assert.strictEqual(summary.overdueCount, 1)
    t.assert.strictEqual(summary.versionCount, 1)
  })

  test('已交付需求即使过期也不计入逾期数', (t) => {
    const { hub, project } = fixture()
    hub.createRequirement({ code: 'REQ-DONE', title: '已交付', project: project.slug, dueDate: '2000-01-01' })
    hub.addVersion(project.slug, {
      versionNo: 'v1', title: '已交付版', html: html(), requirements: ['REQ-DONE']
    })
    hub.setBaseline(project.slug, 'v1')
    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.requirementCount, 1)
    t.assert.strictEqual(summary.overdueCount, 0)
  })
})

describe('项目最新原型摘要', () => {
  test('返回最新非废弃版本及统一展示状态', (t) => {
    const { hub, project } = fixture()
    hub.addVersion(project.slug, { versionNo: 'v1.0', title: '首版原型', html: html() })
    hub.setBaseline(project.slug, 'v1.0')
    hub.addVersion(project.slug, {
      versionNo: 'v2.0', title: '最新可用原型', html: html(),
      changes: [{ type: '修改', location: '项目首页', content: '更新入口' }]
    })
    hub.addVersion(project.slug, {
      versionNo: 'v3.0', title: '已废弃原型', html: html(),
      changes: [{ type: '修改', location: '项目首页', content: '废弃试验' }]
    })
    hub.voidVersion(project.slug, 'v3.0')

    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.versionCount, 3)
    t.assert.strictEqual(summary.baselineVersionNo, 'v1.0')
    t.assert.strictEqual(summary.latestVersion.versionNo, 'v2.0')
    t.assert.strictEqual(summary.latestVersion.title, '最新可用原型')
    t.assert.strictEqual(summary.latestVersion.display.key, 'DRAFT')
    t.assert.strictEqual(typeof summary.latestVersion.updatedAt, 'string')
  })

  test('只有废弃版本时 latestVersion 为 null', (t) => {
    const { hub, project } = fixture()
    hub.addVersion(project.slug, { versionNo: 'v1.0', title: '废弃原型', html: html() })
    hub.voidVersion(project.slug, 'v1.0')
    const summary = hub.getProject(project.slug)
    t.assert.strictEqual(summary.versionCount, 1)
    t.assert.strictEqual(summary.latestVersion, null)
  })
})

describe('项目原型规划摘要', () => {
  test('聚合基线、上一基线、评审数量和累计变更', (t) => {
    const { hub, project } = fixture()
    hub.addVersion(project.slug, { versionNo: 'v1', title: '首版', html: html() })
    hub.setBaseline(project.slug, 'v1')
    hub.addVersion(project.slug, {
      versionNo: 'v2', title: '第二版', html: html(), requirements: [],
      changes: [{ type: 'ADD', location: '首页', content: '增加入口', requirement: 'REQ-1' }]
    })
    hub.setBaseline(project.slug, 'v2')
    hub.addVersion(project.slug, {
      versionNo: 'v3', title: '待评审版', html: html(),
      changes: [{ type: 'MODIFY', location: '首页', content: '调整入口' }]
    })
    hub.addVersion(project.slug, {
      versionNo: 'v4', title: '有疑问版', html: html(),
      changes: [{ type: 'MODIFY', location: '列表', content: '调整筛选' }]
    })
    hub.setReviewStatus(project.slug, 'v4', 'questions')

    const planning = hub.projectPlanning(project.slug)
    t.assert.strictEqual(planning.baseline.versionNo, 'v2')
    t.assert.strictEqual(planning.previousBaseline.versionNo, 'v1')
    t.assert.strictEqual(planning.previousBaselineSource, 'local')
    t.assert.deepStrictEqual(planning.review, { pending: 1, questions: 1, newerThanBaseline: 2 })
    t.assert.strictEqual(planning.changes.itemCount, 1)
    t.assert.deepStrictEqual(planning.changeCounts, { ADD: 1, MODIFY: 0, REMOVE: 0 })
    t.assert.strictEqual(planning.watchCount, 0)
  })

  test('保存个人项目筛选到 cache 并规范化字段', (t) => {
    const { root, hub, project } = fixture()
    const saved = hub.setProjectPreference(project.slug, {
      query: 'REQ-1', task: 'pending', order: 'oldest', author: 'PM', requirement: 'REQ', external: true,
      ignored: 'value'
    })
    t.assert.deepStrictEqual(saved, {
      query: 'REQ-1', task: 'pending', order: 'oldest', author: 'PM', requirement: 'REQ', external: true
    })
    t.assert.deepStrictEqual(hub.getProjectPreference(project.slug), saved)
    t.assert.strictEqual(fs.existsSync(`${root}/.flowlark/cache/project-preferences.json`), true)
    t.assert.strictEqual(fs.existsSync(`${root}/projects/${project.slug}/preferences.json`), false)
  })

  test('回滚预览说明目标版本和将撤回的变更', (t) => {
    const { hub, project } = fixture()
    hub.addVersion(project.slug, { versionNo: 'v1', title: '首版', html: html() })
    hub.setBaseline(project.slug, 'v1')
    hub.addVersion(project.slug, {
      versionNo: 'v2', title: '第二版', html: html(), requirements: ['REQ-X'],
      changes: [{ type: 'MODIFY', location: '首页', content: '调整入口', requirement: 'REQ-X' }]
    })
    hub.setBaseline(project.slug, 'v2')

    const preview = hub.rollbackPreview(project.slug)
    t.assert.strictEqual(preview.current.versionNo, 'v2')
    t.assert.strictEqual(preview.target.versionNo, 'v1')
    t.assert.strictEqual(preview.changes.itemCount, 1)
    t.assert.deepStrictEqual(preview.requirements, ['REQ-X'])
  })
})
