import test from 'node:test'
import assert from 'node:assert/strict'
import {
  comparisonDefaults,
  comparisonQuery,
  normalizeSystemUrl,
  orderedRange,
  traceMarkdown,
} from './compareModel.js'

const versions = [{ versionNo: 'v3' }, { versionNo: 'v2' }, { versionNo: 'v1' }]

test('prefers baseline and a different comparison version', () => {
  assert.deepEqual(comparisonDefaults(versions, 'v2', '', ''), { a: 'v2', b: 'v3' })
  assert.deepEqual(comparisonDefaults(versions, '', 'v1', ''), { a: 'v1', b: 'v3' })
})

test('keeps valid query selections and replaces missing versions', () => {
  assert.deepEqual(comparisonDefaults(versions, 'v2', 'v1', 'v2'), { a: 'v1', b: 'v2' })
  assert.deepEqual(comparisonDefaults(versions, 'v2', 'missing', 'v1'), { a: 'v2', b: 'v1' })
})

test('orders ranges using the project version list', () => {
  assert.deepEqual(orderedRange(versions, 'v3', 'v1'), { older: 'v1', newer: 'v3' })
  assert.deepEqual(orderedRange(versions, 'v1', 'v3'), { older: 'v1', newer: 'v3' })
})

test('normalizes only http and https system URLs', () => {
  assert.equal(normalizeSystemUrl('example.com/app', 'http:'), 'http://example.com/app')
  assert.equal(normalizeSystemUrl('https://example.com/app', 'http:'), 'https://example.com/app')
  assert.equal(normalizeSystemUrl('javascript:alert(1)', 'http:'), '')
  assert.equal(normalizeSystemUrl('not a host', 'http:'), '')
})

test('serializes the active comparison state', () => {
  assert.equal(
    comparisonQuery({ mode: 'versions', a: 'v2', b: 'v3', systemUrl: '', showChanges: true }),
    'mode=versions&a=v2&b=v3',
  )
  assert.equal(
    comparisonQuery({ mode: 'system', a: 'v2', b: '', systemUrl: 'https://example.com/', showChanges: false }),
    'mode=system&a=v2&url=https%3A%2F%2Fexample.com%2F&changes=0',
  )
})

test('renders trace markdown with range, counts, grouped items and requirements', () => {
  const markdown = traceMarkdown({
    project: '订单中心',
    from: 'v1',
    to: 'v2',
    cumulative: {
      versionCount: 2,
      itemCount: 3,
      items: [
        { type: 'ADD', location: '订单列表', content: '增加批量按钮', requirement: 'REQ-1' },
        { type: 'MODIFY', location: '筛选区', content: '保留条件', requirement: 'REQ-2' },
        { type: 'REMOVE', location: '详情', content: '移除旧入口' },
      ],
    },
    paths: { from: '/projects/orders/versions/v1', to: '/projects/orders/versions/v2' },
  })
  assert.match(markdown, /订单中心 · v1 → v2/)
  assert.match(markdown, /新增 1 · 修改 1 · 删除 1/)
  assert.match(markdown, /REQ-1、REQ-2/)
  assert.match(markdown, /\*\*订单列表\*\*：增加批量按钮/)
  assert.match(markdown, /\/projects\/orders\/versions\/v2/)
})

test('escapes table pipes and flattens line breaks in trace markdown', () => {
  const markdown = traceMarkdown({
    project: 'A|B', from: 'v1', to: 'v2',
    cumulative: { items: [{ type: 'MODIFY', location: '筛选|区', content: '第一行\n第二行' }] },
  })
  assert.match(markdown, /A\\\|B/)
  assert.match(markdown, /筛选\\\|区/)
  assert.match(markdown, /第一行 第二行/)
})
