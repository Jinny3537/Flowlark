# Recent Work Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder Flowlark's existing project and version information so a user can identify recent work within 10 seconds and resume it from the dashboard with one click.

**Architecture:** Add one pure frontend model that merges existing project summaries and operation-log entries, validates at most eight non-latest log targets through the existing version endpoint, and returns stable navigation targets. Reuse that model in the dashboard and project library, then make focused hierarchy and responsive-style changes in the project versions page and version workbench without changing backend data, Git behavior, permissions, or business actions.

**Tech Stack:** React 19, React Router 7, Ant Design 6, JavaScript model modules tested with `node:test`, TypeScript/TSX pages, CSS and CSS Modules, Vite 5.

---

## Scope Guard

Implement only the path below:

```text
Dashboard -> Projects -> Project versions -> Version workbench
```

Do not add favorites, pins, visit history, recommendations, backend models, endpoints, search filters, or changes to requirement, milestone, delivery, Git, permission, prototype-editing, feedback, review, compare, download, or baseline behavior.

The working version name is `v0.7.1`, but do not change package versions or create a release tag in this plan. The repository has no `v0.7.0` Git tag and current `main` already contains unreleased work. Release numbering and the release commit range require a separate explicit release-boundary decision.

## File Map

| File | Responsibility |
|---|---|
| `web/src/pages/recentWorkModel.js` | Pure recent-work aggregation, stable sorting, validation decisions and route construction |
| `web/src/pages/recentWorkModel.test.js` | Deterministic model coverage for ordering, deduplication, fallbacks and routes |
| `web/src/pages/ActionCenter.tsx` | Parallel dashboard loading, target validation, recent-work rendering and partial-error messages |
| `web/src/pages/Projects.tsx` | Recent-first project presentation and explicit continue/all-versions actions |
| `web/src/pages/projectVersionsModel.js` | Existing version filtering plus a small pure project-continuation summary |
| `web/src/pages/projectVersionsModel.test.js` | Continuation-summary tests alongside existing version-model tests |
| `web/src/pages/ProjectVersions.tsx` | Latest-version summary and one prominent continue action |
| `web/src/pages/ProjectVersions.module.css` | Project summary and responsive hierarchy styles |
| `web/src/pages/VersionWorkbench.tsx` | Explicit project/version context and updated time in the toolbar |
| `web/src/pages/workbench/VersionWorkbench.module.css` | Desktop and mobile context styles without changing stage sizing |
| `web/src/styles/global.css` | Dashboard recent-work rows, secondary metrics and project-card actions |
| `CHANGELOG.md` | Describe only the experience optimization under Unreleased |

## Task 1: Add the Pure Recent-Work Model

**Files:**

- Create: `web/src/pages/recentWorkModel.js`
- Create: `web/src/pages/recentWorkModel.test.js`

- [ ] **Step 1: Write the failing recent-work model tests**

Create `web/src/pages/recentWorkModel.test.js`:

```js
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
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run:

```bash
node --test web/src/pages/recentWorkModel.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `recentWorkModel.js`.

- [ ] **Step 3: Implement the model with no browser or API dependency**

Create `web/src/pages/recentWorkModel.js`:

```js
function value(value) {
  return String(value || '')
}

function versionNoOf(version) {
  return value(version?.versionNo || version?.no)
}

function latestProjectLogs(logs = []) {
  const ordered = [...logs].sort((a, b) => value(b?.at).localeCompare(value(a?.at)))
  const byProject = new Map()
  for (const log of ordered) {
    const slug = value(log?.project)
    if (slug && !byProject.has(slug)) byProject.set(slug, log)
  }
  return byProject
}

export function projectActivityAt(project, log = null) {
  return [project?.updatedAt, project?.latestVersion?.updatedAt, log?.at]
    .map(value)
    .sort((a, b) => b.localeCompare(a))[0] || ''
}

export function buildRecentWorkCandidates(projects = [], logs = [], limit = 8) {
  const logByProject = latestProjectLogs(logs)
  return projects
    .filter((project) => project?.archived !== true)
    .map((project) => {
      const log = logByProject.get(value(project.slug)) || null
      return {
        slug: value(project.slug),
        projectName: value(project.name || project.slug),
        projectCode: value(project.code || project.slug),
        baselineVersionNo: value(project.baselineVersionNo),
        latestVersion: project.latestVersion || null,
        logVersionNo: value(log?.version),
        activityAt: projectActivityAt(project, log),
        activityDetail: value(log?.detail),
      }
    })
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt)
      || a.projectName.localeCompare(b.projectName, 'zh-CN'))
    .slice(0, Math.max(0, Number(limit) || 0))
}

export function needsTargetValidation(item) {
  const latestNo = versionNoOf(item?.latestVersion)
  return Boolean(item?.logVersionNo && item.logVersionNo !== latestNo)
}

export function resolveRecentWorkTarget(item, checkedVersion = null) {
  const checkedNo = versionNoOf(checkedVersion)
  const checkedKey = value(checkedVersion?.display?.key || checkedVersion?.status)
  const checkedValid = checkedNo === value(item?.logVersionNo) && checkedKey !== 'VOID'
  const target = checkedValid ? checkedVersion : item?.latestVersion
  return {
    ...item,
    targetVersionNo: versionNoOf(target),
    targetVersionTitle: value(target?.title),
    targetDisplay: target?.display || null,
  }
}

export function projectContinueRoute(item) {
  const slug = encodeURIComponent(value(item?.slug))
  const versionNo = value(item?.targetVersionNo || item?.latestVersion?.versionNo || item?.latestVersion?.no)
  return versionNo
    ? `/projects/${slug}/versions/${encodeURIComponent(versionNo)}`
    : `/projects/${slug}`
}

export function sortProjectsByRecent(projects = []) {
  return [...projects].sort((a, b) => projectActivityAt(b).localeCompare(projectActivityAt(a))
    || value(a?.name || a?.slug).localeCompare(value(b?.name || b?.slug), 'zh-CN'))
}
```

- [ ] **Step 4: Run the focused test and verify all cases pass**

Run:

```bash
node --test web/src/pages/recentWorkModel.test.js
```

Expected: 8 tests pass, 0 fail.

- [ ] **Step 5: Commit the model and its tests**

```bash
git add web/src/pages/recentWorkModel.js web/src/pages/recentWorkModel.test.js
git commit -m "feat: model recent project work"
```

## Task 2: Make Recent Work the Dashboard Primary Content

**Files:**

- Modify: `web/src/pages/ActionCenter.tsx:1-139`
- Modify: `web/src/styles/global.css:1055-1193`
- Test: `web/src/pages/recentWorkModel.test.js`

- [ ] **Step 1: Add a failing fallback assertion before page integration**

Append to `web/src/pages/recentWorkModel.test.js`:

```js
test('uses the summarized latest version when the newest log has no version', () => {
  const candidate = buildRecentWorkCandidates(projects, logs, 8)
    .find((item) => item.slug === 'reports')
  const resolved = resolveRecentWorkTarget(candidate, null)
  assert.equal(resolved.targetVersionNo, 'v3')
  assert.equal(projectContinueRoute(resolved), '/projects/reports/versions/v3')
})
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
node --test web/src/pages/recentWorkModel.test.js
```

Expected: 9 tests pass. This locks the fallback before changing the page.

- [ ] **Step 3: Replace dashboard loading with required-project and optional-data loading**

In `web/src/pages/ActionCenter.tsx`, add `ArrowRightOutlined` to the existing icon import and add these imports:

```tsx
import { fmtTime } from '@/utils/format';
import {
  buildRecentWorkCandidates,
  needsTargetValidation,
  projectContinueRoute,
  resolveRecentWorkTarget,
} from './recentWorkModel.js';
```

Add `recentWork` to `DashboardData`, and add a separate optional-source warning state. Keep operation logs local to `load`; they are not rendered or reused after aggregation:

```tsx
const [error, setError] = useState('');
const [warning, setWarning] = useState('');
```

Replace `load` with:

```tsx
const load = useCallback(async () => {
  const failed: string[] = [];
  setLoading(true);
  setError('');
  setWarning('');
  try {
    const [projects, requirements, milestones, deliveries, logs, health] = await Promise.all([
      api.listProjects(),
      api.listRequirements().catch(() => { failed.push('需求'); return []; }),
      api.listMilestones().catch(() => { failed.push('迭代'); return []; }),
      api.listSnapshots().catch(() => { failed.push('交付'); return []; }),
      api.oplog(undefined, 100).catch(() => { failed.push('操作日志'); return []; }),
      api.health().catch(() => { failed.push('工作区状态'); return null; }),
    ]);
    const candidates = buildRecentWorkCandidates(projects, logs, 8);
    const checked = await Promise.all(candidates.map(async (item) => {
      if (!needsTargetValidation(item)) return null;
      try {
        return await api.getVersion(item.slug, item.logVersionNo);
      } catch {
        return null;
      }
    }));
    const recentWork = candidates.map((item, index) => resolveRecentWorkTarget(item, checked[index]));
    setData({ projects, requirements, milestones, deliveries, recentWork, health });
    if (failed.length) setWarning(`${failed.join('、')}数据暂时无法读取`);
  } catch (nextError) {
    setData(emptyData);
    setError(nextError instanceof Error ? nextError.message : '项目数据暂时无法读取');
  } finally {
    setLoading(false);
  }
}, []);
```

Use this complete data shape:

```tsx
type DashboardData = {
  projects: any[];
  requirements: any[];
  milestones: any[];
  deliveries: any[];
  recentWork: any[];
  health: HealthInfo | null;
};

const emptyData: DashboardData = {
  projects: [], requirements: [], milestones: [], deliveries: [],
  recentWork: [], health: null,
};
```

Change the current alert condition from `error` to `warning`, render `warning` as its message, and pass the required-project error to `State`:

```tsx
{warning ? (
  <Alert
    className="fl-dashboard-alert"
    type="warning"
    showIcon
    message={warning}
    description="已保留其他可用数据，可以刷新后重试。"
  />
) : null}

<State loading={loading} error={error} onRetry={load} empty={false}>
  {/* dashboard content */}
</State>
```

- [ ] **Step 4: Replace the fixed workflow rows with recent-work rows**

Keep the existing metric calculations. Change the page-header description to `从最近修改的项目和版本继续处理。`. In the main dashboard panel, use:

```tsx
<section className="fl-dashboard-panel">
  <div className="fl-section-head">
    <div><h2>最近工作</h2><p>按最近修改时间排列，每个项目只显示一次</p></div>
    <Button type="link" onClick={() => navigate('/projects')}>查看全部项目</Button>
  </div>
  {data.recentWork.length ? (
    <div className="fl-recent-work-list">
      {data.recentWork.map((item) => (
        <button
          className="fl-recent-work-item"
          type="button"
          key={item.slug}
          aria-label={`继续处理 ${item.projectName}${item.targetVersionNo ? ` ${item.targetVersionNo}` : ''}`}
          onClick={() => navigate(projectContinueRoute(item))}
        >
          <span className="fl-recent-work-identity">
            <strong>{item.projectName}</strong>
            <span className="fl-mono">{item.projectCode}</span>
          </span>
          <span className="fl-recent-work-version">
            <span>
              <strong className="fl-mono">{item.targetVersionNo || '暂无版本'}</strong>
              {item.targetDisplay ? <Tag color={item.targetDisplay.color}>{item.targetDisplay.short || item.targetDisplay.label}</Tag> : null}
            </span>
            <span>{item.targetVersionTitle || item.activityDetail || '进入项目继续处理'}</span>
          </span>
          <span className="fl-recent-work-time">{fmtTime(item.activityAt)}</span>
          <span className="fl-recent-work-action">继续处理 <ArrowRightOutlined /></span>
        </button>
      ))}
    </div>
  ) : (
    <div className="fl-dashboard-empty">
      <strong>还没有可继续的项目</strong>
      <span>创建或更新项目后，最近工作会显示在这里。</span>
      <Button type="primary" onClick={() => navigate('/projects')}>进入项目</Button>
    </div>
  )}
</section>
```

Render the current metric grid after `fl-dashboard-grid` and add class `fl-metric-grid-secondary`. Keep the current work-area status panel unchanged.

- [ ] **Step 5: Add focused dashboard styles**

Add after the existing dashboard styles in `web/src/styles/global.css`:

```css
.fl-metric-grid-secondary {
  margin-top: var(--pw-space-20);
  margin-bottom: 0;
}

.fl-metric-grid-secondary .fl-metric-card {
  min-height: 116px;
  padding: var(--pw-space-16);
}

.fl-metric-grid-secondary .fl-metric-value {
  font-size: var(--pw-font-size-28);
  line-height: 34px;
}

.fl-recent-work-list {
  display: grid;
}

.fl-recent-work-item {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(150px, .9fr) minmax(220px, 1.5fr) 140px auto;
  align-items: center;
  gap: var(--pw-space-16);
  padding: var(--pw-space-16) 0;
  border: 0;
  border-top: 1px solid var(--pw-color-border);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fl-recent-work-item:first-child { border-top: 0; }
.fl-recent-work-item:hover .fl-recent-work-action { color: var(--pw-color-brand-hover); }
.fl-recent-work-item:focus-visible { outline: 2px solid var(--fl-primary); outline-offset: 2px; }

.fl-recent-work-identity,
.fl-recent-work-version {
  display: grid;
  min-width: 0;
  gap: var(--pw-space-4);
}

.fl-recent-work-identity > span,
.fl-recent-work-version > span:last-child,
.fl-recent-work-time {
  overflow: hidden;
  color: var(--pw-color-text-secondary);
  font-size: var(--pw-font-size-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fl-recent-work-version > span:first-child {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--pw-space-6);
}

.fl-recent-work-version .ant-tag { margin: 0; }
.fl-recent-work-action { color: var(--pw-color-brand); font-weight: 600; white-space: nowrap; }
.fl-dashboard-empty { display: grid; justify-items: start; gap: var(--pw-space-8); padding: var(--pw-space-20) 0; }
.fl-dashboard-empty > span { color: var(--pw-color-text-secondary); }
```

Inside the existing `@media (max-width: 767px)` block add:

```css
.fl-recent-work-item {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--pw-space-8) var(--pw-space-12);
}

.fl-recent-work-version { grid-column: 1 / -1; }
.fl-recent-work-time { grid-column: 1; }
.fl-recent-work-action { grid-column: 2; grid-row: 1; }
```

- [ ] **Step 6: Verify model tests and the production build**

Run:

```bash
node --test web/src/pages/recentWorkModel.test.js
npm run build:web
```

Expected: 8 model tests pass; Vite production build completes without TypeScript or import errors.

- [ ] **Step 7: Commit the dashboard change**

```bash
git add web/src/pages/ActionCenter.tsx web/src/styles/global.css web/src/pages/recentWorkModel.test.js
git commit -m "feat: prioritize recent work on dashboard"
```

## Task 3: Align the Project Library With the Same Continue Target

**Files:**

- Modify: `web/src/pages/Projects.tsx:1-190`
- Modify: `web/src/styles/global.css:900-1053`
- Test: `web/src/pages/recentWorkModel.test.js`

- [ ] **Step 1: Lock the project-card route behavior in the model test**

Append to `web/src/pages/recentWorkModel.test.js`:

```js
test('project cards use their summarized latest version as the continue target', () => {
  assert.equal(projectContinueRoute(projects[0]), '/projects/orders/versions/v2')
  assert.equal(projectContinueRoute(projects[3]), '/projects/empty')
})
```

- [ ] **Step 2: Run the test and verify it passes before page wiring**

```bash
node --test web/src/pages/recentWorkModel.test.js
```

Expected: 10 tests pass.

- [ ] **Step 3: Sort filtered projects and replace the all-card click target with explicit actions**

In `web/src/pages/Projects.tsx`, import `projectContinueRoute` and `sortProjectsByRecent`. Replace the `filtered` calculation with:

```tsx
const filtered = useMemo(
  () => sortProjectsByRecent(filterProjects(items, { query, archived: archiveFilter })),
  [archiveFilter, items, query],
);
```

Replace each `fl-project-entry-card` body with a non-interactive information region and this footer:

```tsx
<article className="fl-project-entry-card" key={item.slug}>
  <div className="fl-project-entry-main">
    <span className="fl-project-entry-head">
      <span className="fl-project-entry-identity">
        <strong className="fl-project-entry-title">{item.name}</strong>
        <span className="fl-project-entry-code fl-mono">{textOf(item.code, item.slug)}</span>
      </span>
      <Badge status={item.archived ? 'default' : 'success'} text={item.archived ? '已归档' : '进行中'} />
    </span>
    {latest ? (
      <span className="fl-project-version-panel">
        <span className="fl-project-version-head">
          <strong className="fl-mono">{latest.versionNo}</strong>
          <Tag color={latest.display?.color}>{latest.display?.short || latest.display?.label}</Tag>
        </span>
        <span className="fl-project-version-title">{textOf(latest.title, '未命名版本')}</span>
        <span className="fl-project-version-time">更新于 {fmtTime(latest.updatedAt)}</span>
      </span>
    ) : (
      <span className="fl-project-version-panel is-empty">
        <strong>暂无可用原型版本</strong>
        <span>进入项目后创建首个版本</span>
      </span>
    )}
    <span className="fl-project-baseline-note">
      当前基线 <strong className="fl-mono">{textOf(item.baselineVersionNo, '未设置')}</strong>
      {latest && item.baselineVersionNo === latest.versionNo ? ' · 最新版本即基线' : latest ? ' · 最新版本尚未设为基线' : ''}
    </span>
  </div>
  <div className="fl-project-entry-actions">
    <Button onClick={() => navigate(`/projects/${encodeURIComponent(item.slug)}`)}>全部版本</Button>
    <Button type="primary" onClick={() => navigate(projectContinueRoute(item))}>
      {latest ? '继续处理' : '进入项目'} <ArrowRightOutlined />
    </Button>
  </div>
  <Dropdown
    trigger={['click']}
    menu={{ items: [{ key: 'edit', label: '编辑项目', icon: <EditOutlined /> }], onClick: () => startEdit(item) }}
  >
    <Button className="fl-project-entry-more" type="text" icon={<MoreOutlined />} disabled={!writable} aria-label={`更多项目操作：${item.name}`} />
  </Dropdown>
</article>
```

- [ ] **Step 4: Update project-card action styles without touching modal styles**

In `web/src/styles/global.css`, keep the existing card surface and version-panel rules. Replace `.fl-project-entry-main` and remove its obsolete `:focus-visible` rule:

```css
.fl-project-entry-main {
  display: flex;
  width: 100%;
  min-height: 220px;
  flex-direction: column;
  padding: var(--pw-space-20);
  color: inherit;
  text-align: left;
}
```

Remove `.fl-project-entry-footer` from the shared selector at lines 952-954 and delete the obsolete `.fl-project-entry-footer` rules at lines 1019-1030. Then add:

```css
.fl-project-baseline-note {
  color: var(--pw-color-text-secondary);
  font-size: var(--pw-font-size-12);
}

.fl-project-entry-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--pw-space-8);
  padding: 0 var(--pw-space-16) var(--pw-space-16);
}
```

Inside `@media (max-width: 767px)` add:

```css
.fl-project-entry-actions { align-items: stretch; flex-direction: column-reverse; }
.fl-project-entry-actions .ant-btn { width: 100%; min-height: 44px; }
```

- [ ] **Step 5: Run tests and build**

```bash
node --test web/src/pages/recentWorkModel.test.js web/src/pages/projectsModel.test.js
npm run build:web
```

Expected: 13 total focused tests pass; production build succeeds.

- [ ] **Step 6: Commit the project-library change**

```bash
git add web/src/pages/Projects.tsx web/src/styles/global.css web/src/pages/recentWorkModel.test.js
git commit -m "feat: align project continue actions"
```

## Task 4: Add a Tested Continuation Summary to the Project Versions Page

**Files:**

- Modify: `web/src/pages/projectVersionsModel.js`
- Modify: `web/src/pages/projectVersionsModel.test.js`
- Modify: `web/src/pages/ProjectVersions.tsx:672-704`
- Modify: `web/src/pages/ProjectVersions.module.css:1-37`

- [ ] **Step 1: Write failing continuation-summary tests**

Add `projectContinuation` to the import list in `web/src/pages/projectVersionsModel.test.js`, then append:

```js
test('summarizes latest usable version and its baseline relationship', () => {
  assert.deepEqual(projectContinuation(versions), {
    latest: versions[0],
    baseline: versions[1],
    relation: { key: 'ahead', label: '最新版本尚未设为基线', color: 'gold' },
  })
  assert.deepEqual(projectContinuation([versions[1], versions[2]]), {
    latest: versions[1],
    baseline: versions[1],
    relation: { key: 'current', label: '最新版本即当前基线', color: 'blue' },
  })
  assert.deepEqual(projectContinuation([]), {
    latest: null,
    baseline: null,
    relation: { key: 'empty', label: '暂无版本', color: 'default' },
  })
})
```

- [ ] **Step 2: Run the focused test and verify the missing export failure**

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: FAIL because `projectContinuation` is not exported.

- [ ] **Step 3: Implement the minimal pure summary**

Add to `web/src/pages/projectVersionsModel.js`:

```js
export function projectContinuation(versions = []) {
  const ordered = filterVersions(versions, { order: 'newest' })
  const latest = ordered.find((version) => version?.display?.key !== 'VOID') || null
  const baseline = ordered.find((version) => version?.isBaseline === true
    || version?.baseline === true
    || version?.display?.key === 'BASELINE') || null
  if (!latest) {
    return { latest: null, baseline, relation: { key: 'empty', label: '暂无版本', color: 'default' } }
  }
  const latestNo = String(latest.versionNo || latest.no || '')
  const baselineNo = String(baseline?.versionNo || baseline?.no || '')
  if (latestNo && latestNo === baselineNo) {
    return { latest, baseline, relation: { key: 'current', label: '最新版本即当前基线', color: 'blue' } }
  }
  return {
    latest,
    baseline,
    relation: {
      key: baseline ? 'ahead' : 'unset',
      label: baseline ? '最新版本尚未设为基线' : '尚未设置当前基线',
      color: 'gold',
    },
  }
}
```

- [ ] **Step 4: Run the model test**

```bash
node --test web/src/pages/projectVersionsModel.test.js
```

Expected: all existing tests and the new continuation test pass.

- [ ] **Step 5: Wire the summary into the page header and project metadata**

Import `projectContinuation`, then add:

```tsx
const continuation = useMemo(() => projectContinuation(versions), [versions]);
```

Replace `PageHeader` actions with:

```tsx
actions={(
  <Space wrap className={styles.summaryActions}>
    <Button icon={<InboxOutlined />} onClick={() => navigate(`/watch?project=${encodeURIComponent(slug)}`)}>
      草稿箱{planning?.watchCount ? ` ${planning.watchCount}` : ''}
    </Button>
    <Button icon={<PlusOutlined />} disabled={!canWrite} onClick={() => setNewVersionOpen(true)}>新建版本</Button>
    {continuation.latest ? (
      <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => openWorkbench(versionNoOf(continuation.latest))}>
        继续处理最新版本
      </Button>
    ) : null}
  </Space>
)}
```

When there are no versions, keep “创建首个版本” as the empty state's only primary action.

Replace `projectMeta` with:

```tsx
<section className={styles.projectMeta} aria-label="项目摘要">
  <span><small>项目代码</small><strong className="fl-mono">{textOf(project?.code, slug)}</strong></span>
  <span><small>最新版本</small><strong className="fl-mono">{continuation.latest ? versionNoOf(continuation.latest) : '暂无版本'}</strong></span>
  <span><small>当前基线</small><strong className="fl-mono">{continuation.baseline ? versionNoOf(continuation.baseline) : '未设置'}</strong></span>
  <span><small>基线关系</small><Tag color={continuation.relation.color}>{continuation.relation.label}</Tag></span>
  <span><small>最近更新</small><strong>{fmtTime(continuation.latest?.updatedAt || continuation.latest?.createdAt || project?.updatedAt)}</strong></span>
</section>
```

- [ ] **Step 6: Reuse the existing responsive summary breakpoints**

Keep the existing five-column desktop rule and the current three-, two- and one-column rules at 899px, 768px and 480px. Add only this tag rule in `web/src/pages/ProjectVersions.module.css`:

```css
.projectMeta :global(.ant-tag) { width: fit-content; margin: 0; white-space: normal; }
```

- [ ] **Step 7: Run focused tests and build**

```bash
node --test web/src/pages/projectVersionsModel.test.js
npm run build:web
```

Expected: focused tests pass; production build succeeds.

- [ ] **Step 8: Commit the project-versions change**

```bash
git add web/src/pages/projectVersionsModel.js web/src/pages/projectVersionsModel.test.js web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git commit -m "feat: clarify project version continuation"
```

## Task 5: Preserve Project and Version Context in the Version Workbench

**Files:**

- Modify: `web/src/pages/VersionWorkbench.tsx:330-391`
- Modify: `web/src/pages/workbench/VersionWorkbench.module.css:11-49,169-209`
- Test: `web/src/pages/workbench/workbenchModel.test.js`

- [ ] **Step 1: Run the existing workbench model test as a behavior baseline**

```bash
node --test web/src/pages/workbench/workbenchModel.test.js
```

Expected: all workbench model tests pass before toolbar-only changes.

- [ ] **Step 2: Replace the toolbar identity with explicit project/version context**

Replace the current formatting import with `import { fmtTime, textOf } from '@/utils/format';`. Replace the current `toolbarIdentity` block with:

```tsx
<div className={styles.toolbarIdentity}>
  <Button
    type="text"
    icon={<ArrowLeftOutlined />}
    aria-label={`返回 ${textOf(project?.name, slug)} 的版本列表`}
    onClick={() => navigate(`/projects/${encodeURIComponent(slug)}`)}
  >
    返回版本列表
  </Button>
  <div className={styles.contextCopy}>
    <div className={styles.contextPath}>
      <span>{textOf(project?.name, slug)}</span>
      <span aria-hidden>/</span>
      <strong className="fl-mono">{versionNo}</strong>
    </div>
    <span className={styles.contextMeta}>
      {textOf(version?.title, '未命名版本')} · 更新于 {fmtTime(version?.updatedAt || version?.createdAt)}
    </span>
  </div>
</div>
```

Keep the version selector, display-status tag, review control, history, compare, link, new-window, download and baseline actions unchanged.

- [ ] **Step 3: Add context styles without changing the preview/document stage**

In `web/src/pages/workbench/VersionWorkbench.module.css`, replace the old `toolbarIdentity strong` rule with:

```css
.contextCopy {
  display: grid;
  min-width: 0;
  max-width: 260px;
  gap: 2px;
}

.contextPath {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--fl-s-1);
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
}

.contextPath > span:first-child,
.contextMeta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contextPath > span:first-child { min-width: 0; }
.contextPath strong { flex: none; color: var(--fl-ink); }
.contextMeta { color: var(--fl-text-2); font-size: 11px; }
```

Inside the existing `@media (max-width: 899px)` block, replace the rule that hides `.toolbarIdentity strong` with:

```css
.contextCopy { max-width: 180px; }
.contextMeta { display: none; }
.toolbarIdentity :global(.ant-btn > span:not(.ant-btn-icon)) { display: none; }
```

Do not change `.page`, `.stage`, `.previewPane`, `.documentPane`, `.splitter` or their sizing rules.

- [ ] **Step 4: Run the behavior baseline and build**

```bash
node --test web/src/pages/workbench/workbenchModel.test.js
npm run build:web
```

Expected: workbench model tests still pass; production build succeeds.

- [ ] **Step 5: Commit the workbench context change**

```bash
git add web/src/pages/VersionWorkbench.tsx web/src/pages/workbench/VersionWorkbench.module.css
git commit -m "style: preserve version workbench context"
```

## Task 6: Run Cross-Page Regression and Record the Optimization

**Files:**

- Modify: `CHANGELOG.md:3-25`
- Verify only: all files changed in Tasks 1-5

- [ ] **Step 1: Run all focused frontend model tests**

```bash
node --test \
  web/src/pages/recentWorkModel.test.js \
  web/src/pages/projectsModel.test.js \
  web/src/pages/projectVersionsModel.test.js \
  web/src/pages/workbench/workbenchModel.test.js
```

Expected: all focused tests pass with 0 failures.

- [ ] **Step 2: Run the production build and full repository test suite**

```bash
npm run build:web
npm test
```

Expected: Vite build succeeds; the full Node test suite has 0 failures. Preserve any pre-existing documented skips.

- [ ] **Step 3: Start a local verification instance**

Run in a dedicated terminal:

```bash
./start.sh --port 7790 --no-open
```

Expected: the service reports a local URL on port 7790 and `/api/health` returns a successful response. Keep the terminal handle so the same process can be stopped after verification.

- [ ] **Step 4: Verify the three core desktop tasks at 1440x900**

Open `http://localhost:7790` and verify:

1. Dashboard: identify the most recent project/version from the visible name, version, update time and status; one click opens `/projects/:slug/versions/:version`.
2. Projects: determine whether latest version equals baseline without opening the project; “继续处理” opens the latest version and “全部版本” opens `/projects/:slug`.
3. Workbench: the project, version, version title, update time, display state and return-to-version-list action are visible; returning and switching to another version do not mix context.

Expected: each target is correct, each page has one dominant continuation action, and no existing business action changed.

- [ ] **Step 5: Verify mobile layout at 390x844**

Using browser responsive emulation, revisit dashboard, projects, project versions and version workbench.

Expected:

- no horizontal page overflow;
- no clipped project or version title;
- primary controls have at least 44px touch height;
- the workbench toolbar may scroll internally but the page does not overflow;
- preview/document switching still fills the available stage;
- status meaning is readable without relying on color.

- [ ] **Step 6: Verify partial failures without changing backend behavior**

In Chrome DevTools, open **Network request blocking**, add `*/api/oplog*`, reload, remove that rule, add `*/api/health*`, and reload again. In both cases leave `*/api/projects*` unblocked. Finally block `*/api/projects*` and reload once more.

Expected: recent work remains navigable and uses project/latest-version timestamps; the warning names the failed optional source. Reject `/api/projects` and verify the dashboard shows a retryable error instead of an empty success state.

- [ ] **Step 7: Stop the same local verification process**

Send `Ctrl-C` to the terminal started in Step 3.

Expected: the process exits cleanly. Do not start a replacement process solely because a browser observation times out.

- [ ] **Step 8: Add the Unreleased changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`, add:

```markdown
### 优化

- 个人工作台改为按现有项目、版本更新时间与操作日志展示最近工作，同一项目只保留一条，并可直接续接到有效版本。
- 项目列表、项目版本页与版本工作台统一最新版本、当前基线、更新时间、续接操作和返回上下文；桌面端与移动端沿用同一状态语义。
- 操作日志、目标版本或健康状态读取失败时按现有项目摘要降级，不改变数据模型、Git、权限或版本业务规则。
```

Do not move the existing Unreleased feature entries and do not bump `package.json` or `web/package.json`.

- [ ] **Step 9: Review the final diff for scope and whitespace**

```bash
git diff --check
git status --short
git diff --stat
git diff -- \
  web/src/pages/recentWorkModel.js \
  web/src/pages/recentWorkModel.test.js \
  web/src/pages/ActionCenter.tsx \
  web/src/pages/Projects.tsx \
  web/src/pages/projectVersionsModel.js \
  web/src/pages/projectVersionsModel.test.js \
  web/src/pages/ProjectVersions.tsx \
  web/src/pages/ProjectVersions.module.css \
  web/src/pages/VersionWorkbench.tsx \
  web/src/pages/workbench/VersionWorkbench.module.css \
  web/src/styles/global.css \
  CHANGELOG.md
```

Expected: no whitespace errors; only the planned files are changed by this implementation. Ignore unrelated pre-existing untracked `.codex-ui-regression/` and `test-results/` files.

- [ ] **Step 10: Commit the regression and changelog closure**

```bash
git add CHANGELOG.md
git commit -m "docs: record recent work continuity update"
```

## Task 7: Complete the Release-Boundary Gate

**Files:**

- Verify: `package.json`
- Verify: `web/package.json`
- Verify: `CHANGELOG.md`
- Verify: Git history and release refs

- [ ] **Step 1: Capture the implementation commit range**

```bash
git log --oneline --decorate -8
git status --short
git tag --sort=-version:refname | head -20
```

Expected: Tasks 1-6 appear as focused commits; only known unrelated files remain untracked; the tag output is recorded as evidence rather than assumed.

- [ ] **Step 2: Confirm the optimization did not change version metadata**

```bash
node -e "const p=require('./package.json'); const w=require('./web/package.json'); console.log({root:p.version,web:w.version})"
```

Expected at implementation-plan completion: both values remain `0.7.0`.

- [ ] **Step 3: Hand the exact release decision to the release owner**

Provide these two explicit choices with the commit IDs from Step 1:

```text
Choice A: Accept the pre-existing Unreleased features and this optimization in one release; choose a version that truthfully represents the combined scope.
Choice B: Ship a patch containing only this optimization from a verified release baseline; first create or identify that baseline, then cherry-pick only the focused implementation commits.
```

Expected: no package version, Git tag or release is created until one choice and its baseline commit are explicitly confirmed.

## Final Completion Checklist

- [ ] Recent-work ordering uses existing project, version and operation-log timestamps.
- [ ] Each active project appears at most once and archived projects do not appear on the dashboard.
- [ ] At most eight non-latest log targets are validated through existing endpoints.
- [ ] Invalid targets fall back to the summarized latest non-void version or project page.
- [ ] Dashboard-to-version continuation takes one click.
- [ ] Projects, project versions and workbench show consistent latest-version, baseline and time context.
- [ ] Existing business actions, backend data, Git and permissions are unchanged.
- [ ] Focused tests, production build and full test suite pass.
- [ ] Desktop and mobile verification tasks pass.
- [ ] The actual release baseline and version remain a separate explicit release decision.
