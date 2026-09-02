import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRecentWorkCandidates,
  needsTargetValidation,
  projectActivityAt,
  projectContinueRoute,
  resolveRecentWorkTarget,
  sortProjectsByRecent,
} from './recentWorkModel.js'

const projects = [
  {
    slug: 'orders', name: '订单中心', code: 'ORD', archived: false,
    updatedAt: '2026-09-01T08:00:00Z', baselineVersionNo: 'v1',
    latestVersion: {
      versionNo: 'v2', title: '批量操作', updatedAt: '2026-09-02T08:00:00Z',
      display: { key: 'DRAFT', label: '编辑中', color: 'gold' },
    },
  },
  {
    slug: 'reports', name: '报表中心', code: 'RPT', archived: false,
    updatedAt: '2026-09-03T08:00:00Z', baselineVersionNo: 'v3',
    latestVersion: {
      versionNo: 'v3', title: '报表基线', updatedAt: '2026-09-03T08:00:00Z',
      display: { key: 'BASELINE', label: '已确认 · 当前基线', color: 'blue' },
    },
  },
  {
    slug: 'legacy', name: '历史项目', code: 'OLD', archived: true,
    updatedAt: '2026-09-04T08:00:00Z', latestVersion: null,
  },
  {
    slug: 'empty', name: '空项目', code: 'EMPTY', archived: false,
    updatedAt: '2026-08-31T08:00:00Z', latestVersion: null,
  },
]

const logs = [
  { project: 'orders', version: 'v1', at: '2026-09-04T09:00:00Z', detail: '更新 v1 的规格书' },
  { project: 'orders', version: 'v2', at: '2026-09-04T08:00:00Z', detail: '更新 v2 的变更日志' },
  { project: 'reports', version: null, at: '2026-09-03T09:00:00Z', detail: '编辑项目 报表中心' },
]

test('uses the latest project, version, or log time as project activity', () => {
  assert.equal(projectActivityAt(projects[0], logs[0]), '2026-09-04T09:00:00Z')
  assert.equal(projectActivityAt(projects[1], null), '2026-09-03T08:00:00Z')
})

test('builds one recent candidate per active project with stable ordering', () => {
  const result = buildRecentWorkCandidates(projects, logs, 8)
  assert.deepEqual(result.map((item) => item.slug), ['orders', 'reports', 'empty'])
  assert.equal(result[0].activityDetail, '更新 v1 的规格书')
  assert.equal(result[0].logVersionNo, 'v1')
  assert.equal(result.some((item) => item.slug === 'legacy'), false)
})

test('limits results after project-level deduplication', () => {
  const many = Array.from({ length: 10 }, (_, index) => ({
    slug: `p${index}`, name: `项目 ${index}`, archived: false,
    updatedAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(), latestVersion: null,
  }))
  assert.equal(buildRecentWorkCandidates(many, [], 8).length, 8)
})

test('breaks equal activity times by project name', () => {
  const sameTime = [
    { slug: 'z', name: '中台', archived: false, updatedAt: '2026-09-01T08:00:00Z' },
    { slug: 'a', name: '报表', archived: false, updatedAt: '2026-09-01T08:00:00Z' },
  ]
  assert.deepEqual(buildRecentWorkCandidates(sameTime, [], 8).map((item) => item.slug), ['a', 'z'])
})

test('validates only a log version that differs from the summarized latest version', () => {
  const [orders, reports] = buildRecentWorkCandidates(projects, logs, 8)
  assert.equal(needsTargetValidation(orders), true)
  assert.equal(needsTargetValidation(reports), false)
})

test('uses a valid log target and falls back from void or missing targets', () => {
  const [candidate] = buildRecentWorkCandidates(projects, logs, 8)
  assert.equal(resolveRecentWorkTarget(candidate, {
    versionNo: 'v1', title: '首版', display: { key: 'HISTORY' },
  }).targetVersionNo, 'v1')
  assert.equal(resolveRecentWorkTarget(candidate, {
    versionNo: 'v1', title: '废弃版', display: { key: 'VOID' },
  }).targetVersionNo, 'v2')
  assert.equal(resolveRecentWorkTarget(candidate, null).targetVersionNo, 'v2')
})

test('creates a direct workbench route or a project fallback route', () => {
  const orderItem = resolveRecentWorkTarget(buildRecentWorkCandidates(projects, logs, 8)[0], null)
  const emptyItem = resolveRecentWorkTarget(buildRecentWorkCandidates(projects, logs, 8)[2], null)
  assert.equal(projectContinueRoute(orderItem), '/projects/orders/versions/v2')
  assert.equal(projectContinueRoute(emptyItem), '/projects/empty')
})

test('sorts project cards by project or latest-version update without mutation', () => {
  const input = [projects[0], projects[1], projects[3]]
  const before = structuredClone(input)
  assert.deepEqual(sortProjectsByRecent(input).map((item) => item.slug), ['reports', 'orders', 'empty'])
  assert.deepEqual(input, before)
})

test('uses the summarized latest version when the newest log has no version', () => {
  const candidate = buildRecentWorkCandidates(projects, logs, 8)
    .find((item) => item.slug === 'reports')
  const resolved = resolveRecentWorkTarget(candidate, null)
  assert.equal(resolved.targetVersionNo, 'v3')
  assert.equal(projectContinueRoute(resolved), '/projects/reports/versions/v3')
})

test('project cards use their summarized latest version as the continue target', () => {
  assert.equal(projectContinueRoute(projects[0]), '/projects/orders/versions/v2')
  assert.equal(projectContinueRoute(projects[3]), '/projects/empty')
})
