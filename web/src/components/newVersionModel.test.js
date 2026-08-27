import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySuggestion,
  buildBatchQueue,
  inferVersionNo,
  nextVersionSuggestion,
  queueResultSummary,
  reusableMetadata,
  reviewMarkdown,
  sourceSummary,
  suggestVersionNo,
  validateHtmlFile,
} from './newVersionModel.js'

test('accepts html and htm files within the configured limit', () => {
  assert.equal(validateHtmlFile({ name: 'demo.html', size: 100 }, 200), '')
  assert.equal(validateHtmlFile({ name: 'demo.htm', size: 100 }, 200), '')
})

test('rejects wrong extensions and oversized files', () => {
  assert.equal(validateHtmlFile({ name: 'demo.txt', size: 100 }, 200), '仅支持 .html 或 .htm 文件')
  assert.equal(validateHtmlFile({ name: 'demo.html', size: 201 }, 200), '文件超过 200 B 上限')
})

test('summarizes bytes and external dependencies', () => {
  assert.equal(sourceSummary('', []), '尚未读取 HTML')
  assert.equal(sourceSummary('1234', []), '4 B · 无外部依赖')
  assert.equal(sourceSummary('1234', ['https://cdn/a.css']), '4 B · 1 个外部依赖')
})

test('infers file versions and suggests only dotted numeric successors', () => {
  assert.equal(inferVersionNo('订单中心_v2.4.html'), 'v2.4')
  assert.equal(inferVersionNo('prototype.html'), '')
  assert.equal(suggestVersionNo('v2.3.9'), 'v2.3.10')
  assert.equal(suggestVersionNo('v9'), 'v10')
  assert.equal(suggestVersionNo('final'), '')
})

test('prefers a file version then falls back to the latest numeric version', () => {
  const versions = [{ versionNo: 'v2.4' }, { versionNo: 'v2.3' }]
  assert.equal(nextVersionSuggestion(versions, 'demo-v8.html'), 'v8')
  assert.equal(nextVersionSuggestion(versions, 'demo.html'), 'v2.5')
  assert.equal(nextVersionSuggestion([{ versionNo: 'final' }], 'demo.html'), '')
})

test('does not overwrite manually touched values', () => {
  assert.equal(applySuggestion('', 'v2', false), 'v2')
  assert.equal(applySuggestion('v-custom', 'v2', true), 'v-custom')
  assert.equal(applySuggestion('已有标题', '自动标题', false), '已有标题')
})

test('builds an ordered batch queue with duplicate and file errors', () => {
  const queue = buildBatchQueue([
    { name: 'demo-v2.html', size: 10 },
    { name: 'demo-v2-copy.html', size: 10 },
    { name: 'notes.txt', size: 10 },
    { name: 'large-v3.html', size: 201 },
  ], { maxBytes: 200, existingVersionNos: ['v1'] })

  assert.equal(queue[0].suggestedVersionNo, 'v2')
  assert.equal(queue[0].error, '')
  assert.equal(queue[1].error, '批次内版本号 v2 重复')
  assert.equal(queue[2].error, '仅支持 .html 或 .htm 文件')
  assert.equal(queue[3].error, '文件超过 200 B 上限')
})

test('marks versions that already exist in a project', () => {
  const [item] = buildBatchQueue([{ name: 'demo-v2.html', size: 10 }], {
    maxBytes: 200, existingVersionNos: ['v2']
  })
  assert.equal(item.error, '版本号 v2 已存在')
})

test('reuses requirements and locations without copying historical descriptions', () => {
  assert.deepEqual(reusableMetadata({
    requirements: [{ code: 'REQ-1', title: '需求一' }],
    tags: ['已评审'],
    changes: [
      { location: '订单列表', content: '旧说明' },
      { location: '订单列表', content: '重复位置' },
      { location: '筛选区', content: '旧说明二' },
    ],
  }), {
    requirements: [{ code: 'REQ-1', title: '需求一' }],
    tags: ['已评审'],
    locations: ['订单列表', '筛选区'],
  })
})

test('renders portable review markdown and batch result counts', () => {
  const markdown = reviewMarkdown({
    projectName: '订单中心', project: 'orders', versionNo: 'v2', title: '批量操作',
    baselineVersionNo: 'v1', changes: [{ type: 'MODIFY', location: '列表', content: '增加批量操作' }],
    requirementCount: 1, path: '/projects/orders/versions/v2'
  })
  assert.match(markdown, /订单中心 · v2/)
  assert.match(markdown, /当前基线：v1/)
  assert.match(markdown, /增加批量操作/)
  assert.match(markdown, /\/projects\/orders\/versions\/v2/)

  assert.deepEqual(queueResultSummary([
    { status: 'created' }, { status: 'failed' }, { status: 'created' }, { status: 'pending' }
  ]), { created: 2, failed: 1, pending: 1 })
})
