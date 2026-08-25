import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProjects, initialProjectValues, isProjectCodeAllowed, projectPayload } from './projectsModel.js'

const items = [
  { slug: 'hyzl', name: '华油中蓝', code: 'HYZL', description: '安全生产', priority: 'P1', archived: false },
  { slug: 'legacy', name: '旧项目', code: 'legacy-code', description: '历史数据', priority: '', archived: true }
]

test('filters project rows by query, priority, and archive state', () => {
  assert.deepEqual(filterProjects(items, { query: '安全' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { priority: 'P1' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { archived: 'archived' }).map((item) => item.slug), ['legacy'])
  assert.deepEqual(filterProjects(items, { archived: 'active' }).map((item) => item.slug), ['hyzl'])
})

test('normalizes create and edit form values', () => {
  assert.deepEqual(initialProjectValues(), { name: '', code: '', description: '', priority: undefined, archived: false })
  assert.deepEqual(initialProjectValues(items[0]), {
    name: '华油中蓝', code: 'HYZL', description: '安全生产', priority: 'P1', archived: false
  })
  assert.deepEqual(projectPayload({ name: ' 华油中蓝 ', code: ' HYZL ', description: ' 范围 ', priority: undefined, archived: false }), {
    name: '华油中蓝', code: 'HYZL', description: ' 范围 ', priority: '', archived: false
  })
})

test('accepts new uppercase codes and unchanged legacy codes', () => {
  assert.equal(isProjectCodeAllowed('HYZL2'), true)
  assert.equal(isProjectCodeAllowed('bad-code'), false)
  assert.equal(isProjectCodeAllowed('legacy-code', 'legacy-code'), true)
})
