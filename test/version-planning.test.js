import assert from 'node:assert/strict'
import test from 'node:test'
import {
  preflightVersion,
  previousBaseline,
  reviewSummary,
  suggestVersionNo,
  traceMarkdown
} from '../src/core/version-planning.js'

test('suggests only numeric dotted versions', () => {
  assert.equal(suggestVersionNo('v1.4'), 'v1.5')
  assert.equal(suggestVersionNo('V2.3.9'), 'v2.3.10')
  assert.equal(suggestVersionNo('v9'), 'v10')
  assert.equal(suggestVersionNo('release-final'), '')
  assert.equal(suggestVersionNo(''), '')
})

test('preflight blocks incomplete review versions and keeps warnings non-blocking', () => {
  const result = preflightVersion({
    html: '<html><head><title>Demo</title><link href="https://cdn.example/x.css"></head></html>',
    versionNo: 'v2',
    title: 'Demo',
    changes: [],
    requirements: [],
    existingVersionNos: ['v1'],
    maxFileBytes: 10_000
  })

  assert.equal(result.ready, false)
  assert.deepEqual(result.blockers.map((item) => item.code), ['CHANGELOG_REQUIRED'])
  assert.deepEqual(result.warnings.map((item) => item.code), ['EXTERNAL_REFS', 'REQUIREMENTS_EMPTY'])
  assert.equal(result.inspection.externalRefs.length, 1)
  assert.equal(result.inspection.size > 0, true)
})

test('preflight permits an empty first-version changelog and reports every field blocker', () => {
  const first = preflightVersion({
    html: '<html></html>', versionNo: 'v1', title: '首版', changes: [], requirements: ['REQ-1'],
    existingVersionNos: [], maxFileBytes: 10_000
  })
  assert.equal(first.ready, true)
  assert.deepEqual(first.blockers, [])

  const invalid = preflightVersion({
    html: '', versionNo: 'bad/version', title: ' ', changes: [], requirements: [],
    existingVersionNos: ['bad/version'], maxFileBytes: 1
  })
  assert.deepEqual(invalid.blockers.map((item) => item.code), [
    'FILE_REQUIRED', 'VERSION_NO_INVALID', 'VERSION_EXISTS', 'TITLE_REQUIRED', 'CHANGELOG_REQUIRED'
  ])
})

test('preflight reports read-only, impact, and external dependency warnings', () => {
  const result = preflightVersion({
    html: '<script src="https://cdn.example/app.js"></script>',
    versionNo: 'v2', title: '二版',
    changes: [{ type: 'MODIFY', location: '列表', content: '调整筛选' }],
    requirements: ['REQ-2'], existingVersionNos: ['v1'], maxFileBytes: 10_000,
    impacts: [{ location: '列表' }], canWrite: false, gitKnown: false
  })
  assert.deepEqual(result.warnings.map((item) => item.code), [
    'EXTERNAL_REFS', 'HISTORICAL_IMPACT', 'READ_ONLY', 'GIT_UNKNOWN'
  ])
})

test('prefers Git baseline history and falls back to baseline timestamps', () => {
  const versions = [
    { versionNo: 'v3', baselineAt: '2026-08-03T00:00:00Z', status: 'READY' },
    { versionNo: 'v2', baselineAt: '2026-08-02T00:00:00Z', status: 'READY' },
    { versionNo: 'v1', baselineAt: '2026-08-01T00:00:00Z', status: 'READY' }
  ]
  assert.deepEqual(previousBaseline(versions, 'v3', [
    { versionNo: 'v3', hash: '3' }, { versionNo: 'v1', hash: '1' }
  ]), { version: versions[2], source: 'git', history: { versionNo: 'v1', hash: '1' } })

  assert.deepEqual(previousBaseline(versions, 'v3', []), {
    version: versions[1], source: 'local', history: null
  })

  assert.equal(previousBaseline([{ versionNo: 'v1', baselineAt: null }], 'v1', []), null)
})

test('summarizes pending and questions independently from lifecycle', () => {
  const summary = reviewSummary([
    { versionNo: 'v4', status: 'DRAFT', reviewStatus: 'pending' },
    { versionNo: 'v3', status: 'DRAFT', reviewStatus: 'questions' },
    { versionNo: 'v2', status: 'READY', reviewStatus: 'confirmed' },
    { versionNo: 'v1', status: 'VOID', reviewStatus: 'pending' }
  ], 'v2')
  assert.deepEqual(summary, { pending: 1, questions: 1, newerThanBaseline: 2 })
})

test('renders a stable trace markdown summary', () => {
  const markdown = traceMarkdown({
    project: '订单中心',
    from: 'v1',
    to: 'v2',
    cumulative: {
      versionCount: 2,
      itemCount: 2,
      items: [
        { type: 'ADD', location: '订单列表', content: '增加批量按钮', requirement: 'REQ-1' },
        { type: 'MODIFY', location: '筛选区', content: '保留筛选条件', requirement: 'REQ-2' }
      ]
    },
    paths: { from: '/projects/orders/versions/v1', to: '/projects/orders/versions/v2' }
  })

  assert.match(markdown, /^# 订单中心 · v1 → v2/m)
  assert.match(markdown, /新增 1 · 修改 1 · 删除 0/)
  assert.match(markdown, /REQ-1/)
  assert.match(markdown, /\/projects\/orders\/versions\/v2/)
})
