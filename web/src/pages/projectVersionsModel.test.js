import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adjacentVersionNo,
  comparisonTargets,
  filterVersions,
  planningBadges,
  projectFilterQuery,
  projectFilterState,
  reviewStateOf,
} from './projectVersionsModel.js'

const versions = [
  {
    versionNo: 'v3', title: '批量关闭校验', createdBy: 'Jinny', updatedBy: 'Ming',
    createdAt: '2026-08-24T08:00:00Z', display: { key: 'DRAFT' }, tags: ['批量操作'],
    reviewStatus: 'pending', externalRefs: ['https://cdn.example/app.js'],
    requirements: [{ code: 'REQ-3', title: '订单关闭' }],
  },
  {
    no: 'v2', title: '操作日志优化', createdBy: 'protohub', updatedAt: '2026-08-23T08:00:00Z',
    display: { key: 'BASELINE' }, reviewStatus: 'questions', tags: ['审计'],
    requirements: [{ code: 'REQ-2', title: '日志筛选' }],
  },
  {
    versionNo: 'v1', title: '首版原型', createdBy: 'protohub', updatedBy: 'Kai',
    createdAt: '2026-08-22T08:00:00Z', display: { key: 'HISTORY' }, reviewStatus: 'confirmed',
    baselineAt: '2026-08-22T09:00:00Z', tags: [], requirements: [],
  },
]

const versionNo = (version) => version.versionNo || version.no

test('filters by every supported search field', () => {
  const cases = [
    ['V3', 'v3'], ['v2', 'v2'], ['关闭校验', 'v3'], ['jinny', 'v3'],
    ['MING', 'v3'], ['批量操作', 'v3'], ['REQ-3', 'v3'], ['订单关闭', 'v3'],
  ]
  for (const [query, expected] of cases) {
    assert.deepEqual(filterVersions(versions, { query }).map(versionNo), [expected], query)
  }
})

test('filters against display.key and supports all', () => {
  assert.deepEqual(filterVersions(versions, { status: 'BASELINE' }).map(versionNo), ['v2'])
  assert.deepEqual(filterVersions(versions, { status: 'all' }).map(versionNo), ['v3', 'v2', 'v1'])
})

test('filters review tasks independently from lifecycle', () => {
  assert.deepEqual(filterVersions(versions, { task: 'pending' }).map(versionNo), ['v3'])
  assert.deepEqual(filterVersions(versions, { task: 'questions' }).map(versionNo), ['v2'])
  assert.deepEqual(filterVersions(versions, { task: 'baseline-history' }).map(versionNo), ['v2', 'v1'])
  assert.deepEqual(filterVersions([...versions, {
    versionNo: 'v0', status: 'VOID', display: { key: 'VOID' }, reviewStatus: 'obsolete', createdAt: '2026-08-20T00:00:00Z'
  }], { task: 'void' }).map(versionNo), ['v0'])
})

test('filters author, requirement, and external-resource fields', () => {
  assert.deepEqual(filterVersions(versions, { author: 'jin' }).map(versionNo), ['v3'])
  assert.deepEqual(filterVersions(versions, { requirement: '日志' }).map(versionNo), ['v2'])
  assert.deepEqual(filterVersions(versions, { external: true }).map(versionNo), ['v3'])
})

test('sorts shuffled versions newest and oldest without mutating input', () => {
  const shuffled = [versions[1], versions[2], versions[0]]
  const before = structuredClone(shuffled)
  assert.deepEqual(filterVersions(shuffled, { order: 'newest' }).map(versionNo), ['v3', 'v2', 'v1'])
  assert.deepEqual(filterVersions(shuffled, { order: 'oldest' }).map(versionNo), ['v1', 'v2', 'v3'])
  assert.deepEqual(shuffled, before)
})

test('uses lexical version number tie-breaks for equal timestamps', () => {
  const sameTime = ['v10', 'v1', 'v2'].map((value) => ({
    versionNo: value, createdAt: '2026-08-24T08:00:00Z', display: { key: 'DRAFT' },
  }))
  assert.deepEqual(filterVersions(sameTime, { order: 'newest' }).map(versionNo), ['v2', 'v10', 'v1'])
  assert.deepEqual(filterVersions(sameTime, { order: 'oldest' }).map(versionNo), ['v1', 'v10', 'v2'])
})

test('uses updatedAt when createdAt is absent', () => {
  const fallbackDates = [
    { no: 'v1', updatedAt: '2026-08-20T08:00:00Z' },
    { no: 'v2', updatedAt: '2026-08-21T08:00:00Z' },
  ]
  assert.deepEqual(filterVersions(fallbackDates, { order: 'newest' }).map(versionNo), ['v2', 'v1'])
})

test('moves to adjacent versions and remains within bounds', () => {
  assert.equal(adjacentVersionNo(versions, 'v2', -1), 'v3')
  assert.equal(adjacentVersionNo(versions, 'v2', 1), 'v1')
  assert.equal(adjacentVersionNo(versions, 'v3', -1), 'v3')
  assert.equal(adjacentVersionNo(versions, 'v1', 1), 'v1')
  assert.equal(adjacentVersionNo(versions, 'missing', 1), 'v3')
  assert.equal(adjacentVersionNo([], 'v1', 1), null)
})

test('handles a 60-version project without dropping a valid match', () => {
  const manyVersions = Array.from({ length: 60 }, (_, index) => ({
    versionNo: `v${index + 1}`,
    title: index === 47 ? '唯一命中的历史版本' : `版本 ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    display: { key: index % 2 === 0 ? 'DRAFT' : 'HISTORY' },
  }))
  assert.equal(filterVersions(manyVersions).length, 60)
  assert.deepEqual(
    filterVersions(manyVersions, { query: '唯一命中', status: 'HISTORY' }).map(versionNo),
    ['v48'],
  )
})

test('chooses only valid distinct common comparison targets', () => {
  assert.deepEqual(comparisonTargets(versions, 'v2', 'v3', 'v1'), {
    selectedVsBaseline: { a: 'v2', b: 'v3' },
    latestVsBaseline: { a: 'v2', b: 'v3' },
    baselineVsPrevious: { a: 'v1', b: 'v2' },
  })
  assert.deepEqual(comparisonTargets(versions, 'v2', 'v2', ''), {
    selectedVsBaseline: null,
    latestVsBaseline: { a: 'v2', b: 'v3' },
    baselineVsPrevious: null,
  })
  assert.deepEqual(comparisonTargets([], '', '', ''), {
    selectedVsBaseline: null,
    latestVsBaseline: null,
    baselineVsPrevious: null,
  })
})

test('serializes filters to stable shareable query state', () => {
  const query = projectFilterQuery({
    query: 'REQ-3', task: 'pending', status: 'DRAFT', order: 'oldest',
    author: 'Jinny', requirement: 'REQ', external: true, includeVoid: true,
  })
  assert.equal(query, 'q=REQ-3&task=pending&status=DRAFT&order=oldest&author=Jinny&requirement=REQ&external=1&void=1')
  assert.deepEqual(projectFilterState(new URLSearchParams(query)), {
    query: 'REQ-3', task: 'pending', status: 'DRAFT', order: 'oldest',
    author: 'Jinny', requirement: 'REQ', external: true, includeVoid: true,
  })
  assert.equal(projectFilterQuery(projectFilterState(new URLSearchParams(''))), '')
})

test('maps review states and planning badges to readable labels', () => {
  assert.deepEqual(reviewStateOf({ reviewStatus: 'pending' }), { key: 'pending', label: '待评审', color: 'orange' })
  assert.deepEqual(reviewStateOf({ reviewStatus: 'questions' }), { key: 'questions', label: '有疑问', color: 'red' })
  assert.deepEqual(planningBadges({ review: { pending: 2, questions: 1 }, watchCount: 3 }), [
    { key: 'pending', label: '2 个待评审', color: 'orange' },
    { key: 'questions', label: '1 个有疑问', color: 'red' },
    { key: 'watch', label: '3 个待归档', color: 'blue' },
  ])
})
