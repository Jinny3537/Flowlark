import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProjects, initialProjectValues, isProjectCodeAllowed, projectPayload } from './projectsModel.js'

const items = [
  { slug: 'hyzl', name: '华油中蓝', code: 'HYZL', description: '安全生产', priority: 'P1', archived: false },
  { slug: 'legacy', name: '旧项目', code: 'legacy-code', description: '历史数据', priority: '', archived: true }
]

test('filters project rows by visible query fields, priority, and archive state', () => {
  assert.deepEqual(filterProjects(items, { query: '华油' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { query: 'HYZL' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { query: '安全生产' }).map((item) => item.slug), [])
  assert.deepEqual(filterProjects(items, { priority: 'P1' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { archived: 'archived' }).map((item) => item.slug), ['legacy'])
  assert.deepEqual(filterProjects(items, { archived: 'active' }).map((item) => item.slug), ['hyzl'])
})

test('normalizes create and edit form values', () => {
  assert.deepEqual(initialProjectValues(), {
    name: '', code: '', description: '', priority: undefined, archived: false,
    releaseMail: {
      enabled: false, to: [], cc: [],
      subjectTemplate: '【发版】{{project}} {{version}}',
      bodyTemplate: '# {{project}} {{version}}\n\n## 版本说明\n\n{{title}}\n\n## 变更摘要\n\n{{changes}}\n\n## 关联需求\n\n{{requirements}}\n\n---\n\n发布人：{{releasedBy}}  \n发布时间：{{releasedAt}}'
    }
  })
  assert.deepEqual(initialProjectValues(items[0]), {
    name: '华油中蓝', code: 'HYZL', description: '安全生产', priority: 'P1', archived: false,
    releaseMail: initialProjectValues().releaseMail,
  })
  assert.deepEqual(projectPayload({
    name: ' 华油中蓝 ', code: ' HYZL ', description: ' 范围 ', priority: undefined, archived: false,
    releaseMail: {
      enabled: true, to: [' 张三 ', '张三'], cc: [' 李四 '],
      subjectTemplate: '主题', bodyTemplate: '正文'
    }
  }), {
    name: '华油中蓝', code: 'HYZL', description: ' 范围 ', priority: '', archived: false,
    releaseMail: { enabled: true, to: ['张三'], cc: ['李四'], subjectTemplate: '主题', bodyTemplate: '正文' }
  })
})

test('accepts new uppercase codes and unchanged legacy codes', () => {
  assert.equal(isProjectCodeAllowed('HYZL2'), true)
  assert.equal(isProjectCodeAllowed('bad-code'), false)
  assert.equal(isProjectCodeAllowed('legacy-code', 'legacy-code'), true)
})
