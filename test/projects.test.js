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
