# Project Prototype Management Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement F01–F17 from the approved project prototype management upgrade design, including quick publishing, review-aware baseline management, common comparisons, history, filtering, exports, watch integration, and rollback preview.

**Architecture:** Keep `Hub` and core rules as the business source of truth. Add a focused pure core planning module for preflight and baseline derivation, extend existing HTTP routes, and keep deterministic UI transformations in the existing page/component model files. Reuse `NewVersionDialog`, `ProjectVersions`, `Compare`, the Git assistant, saved views, and watch inbox instead of introducing a parallel workflow.

**Tech Stack:** Node.js ESM, `node:test`, React 18, TypeScript, Ant Design, React Router, Vite, CSS Modules.

---

## File map

- Create `src/core/version-planning.js`: pure version-number suggestion, preflight result construction, previous-baseline fallback, review summary, and trace Markdown.
- Create `src/core/project-preferences.js`: personal project filter preferences stored below `.flowlark/cache`.
- Modify `src/core/rules.js`: block a `questions` version from becoming a new baseline.
- Modify `src/core/service.js`: expose preflight, project planning summary, filter preferences, and rollback preview.
- Modify `src/server/routes.js`: add preflight, project planning, preference, and rollback-preview endpoints.
- Create `test/version-planning.test.js`: deterministic core rule coverage.
- Modify `test/review.test.js`, `test/projects.test.js`, and `test/v07-upgrade.test.js`: service and HTTP coverage.
- Modify `web/src/components/newVersionModel.js`: version suggestion, batch queue, publish result, and review-summary helpers.
- Modify `web/src/components/newVersionModel.test.js`: pure publishing model coverage.
- Modify `web/src/components/NewVersionDialog.tsx`: F01–F05, F12, and F13.
- Modify `web/src/pages/projectVersionsModel.js`: task filters, baseline comparison targets, planning counts, and query serialization.
- Modify `web/src/pages/projectVersionsModel.test.js`: deterministic project-page behavior.
- Modify `web/src/pages/ProjectVersions.tsx`: F06–F11, F14, F15, and F17.
- Modify `web/src/pages/ProjectVersions.module.css`: baseline command area, task filters, planning/history/rollback/result layouts.
- Modify `web/src/pages/WatchInbox.tsx`: project-scoped inbox entry.
- Modify `web/src/pages/compareModel.js`, `web/src/pages/compareModel.test.js`, and `web/src/pages/Compare.tsx`: F16 trace Markdown and copy action.
- Modify `web/src/services/api.ts`: typed wrappers for the new routes.
- Modify `web/src/styles/global.css`: publishing dialog queue/result styles.

### Task 1: Core version planning rules

**Files:**
- Create: `src/core/version-planning.js`
- Create: `test/version-planning.test.js`
- Modify: `src/core/rules.js`
- Modify: `test/review.test.js`

- [ ] **Step 1: Write failing tests for version suggestion, preflight, review summary, previous-baseline fallback, trace export, and questions gating**

```js
test('suggests only numeric dotted versions', () => {
  assert.equal(suggestVersionNo('v1.4'), 'v1.5')
  assert.equal(suggestVersionNo('v2.3.9'), 'v2.3.10')
  assert.equal(suggestVersionNo('release-final'), '')
})

test('preflight blocks incomplete review versions and keeps warnings non-blocking', () => {
  const result = preflightVersion({
    html: '<html><title>Demo</title><link href="https://cdn/x.css"></html>',
    versionNo: 'v2', title: 'Demo', changes: [], requirements: [], existingVersionNos: ['v1'], maxFileBytes: 10000,
  })
  assert.equal(result.ready, false)
  assert.deepEqual(result.blockers.map((item) => item.code), ['CHANGELOG_REQUIRED'])
  assert.deepEqual(result.warnings.map((item) => item.code), ['EXTERNAL_REFS', 'REQUIREMENTS_EMPTY'])
})

test('questions must be resolved before setting a forward baseline', () => {
  hub.addVersion('orders', { versionNo: 'v2', title: '二版', html: html(), changes: [{ type: '修改', location: '列表', content: '调整' }] })
  hub.setReviewStatus('orders', 'v2', 'questions')
  throwsCode(t, 'REVIEW_QUESTIONS_BLOCKED', () => hub.setBaseline('orders', 'v2'))
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/version-planning.test.js test/review.test.js`

Expected: FAIL because `version-planning.js` and the questions guard do not exist.

- [ ] **Step 3: Implement pure planning functions and the baseline guard**

```js
export function suggestVersionNo(value) {
  const match = /^(v)(\d+(?:\.\d+)*)$/i.exec(String(value || '').trim())
  if (!match) return ''
  const parts = match[2].split('.').map(Number)
  parts[parts.length - 1] += 1
  return `v${parts.join('.')}`
}

export function reviewSummary(versions, baselineNo) {
  const usable = versions.filter((item) => item.status !== 'VOID')
  return {
    pending: usable.filter((item) => item.reviewStatus === 'pending' && item.versionNo !== baselineNo).length,
    questions: usable.filter((item) => item.reviewStatus === 'questions').length,
  }
}
```

`preflightVersion` must return `{ ready, blockers, warnings, inspection }`, enforce HTML/title/version/duplicate/changelog blockers, and emit external-reference and missing-requirement warnings. `previousBaseline` must prefer normalized Git history, then fall back to the newest non-current `baselineAt` version. `traceMarkdown` must render project, range, counts, grouped changes, requirements, and paths.

Add to `Hub.setBaseline` before changelog validation:

```js
if (!v.baselineAt && v.reviewStatus === 'questions') {
  throw err.bad('REVIEW_QUESTIONS_BLOCKED', `${versionNo} 仍有评审疑问，不能设为基线`, '先处理问题并更新评审状态')
}
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/version-planning.test.js test/review.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/core/version-planning.js src/core/rules.js test/version-planning.test.js test/review.test.js
git commit -m "feat: add version publishing planning rules"
```

### Task 2: Service and HTTP planning endpoints

**Files:**
- Create: `src/core/project-preferences.js`
- Modify: `src/core/service.js`
- Modify: `src/server/routes.js`
- Modify: `test/projects.test.js`
- Modify: `test/v07-upgrade.test.js`
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: Write failing Hub and HTTP tests**

```js
test('project planning aggregates baseline, previous baseline, review counts, watch count and cumulative changes', (t) => {
  const planning = hub.projectPlanning('orders')
  t.assert.strictEqual(planning.baseline.versionNo, 'v2')
  t.assert.strictEqual(planning.previousBaseline.versionNo, 'v1')
  t.assert.strictEqual(planning.review.pending, 1)
  t.assert.strictEqual(planning.changes.itemCount, 1)
})

test('personal project filters round trip below cache', (t) => {
  hub.setProjectPreference('orders', { query: 'REQ-1', task: 'pending', order: 'newest' })
  t.assert.deepStrictEqual(hub.getProjectPreference('orders'), { query: 'REQ-1', task: 'pending', order: 'newest' })
})
```

HTTP coverage must call:

```text
POST /api/projects/orders/version-preflight
GET  /api/projects/orders/planning
GET  /api/projects/orders/preferences
PUT  /api/projects/orders/preferences
GET  /api/projects/orders/rollback-preview
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/projects.test.js test/v07-upgrade.test.js`

Expected: FAIL because Hub methods and routes are missing.

- [ ] **Step 3: Implement cache preferences and Hub methods**

```js
// src/core/project-preferences.js
export function normalizePreference(input = {}) {
  return {
    query: String(input.query || '').slice(0, 200),
    task: ['all', 'pending', 'questions', 'baseline-history', 'void'].includes(input.task) ? input.task : 'all',
    order: input.order === 'oldest' ? 'oldest' : 'newest',
    author: String(input.author || '').slice(0, 120),
    requirement: String(input.requirement || '').slice(0, 120),
    external: input.external === true,
  }
}
```

Store preferences atomically at `.flowlark/cache/project-preferences.json`. Add `Hub.preflightVersion`, `Hub.projectPlanning`, `Hub.getProjectPreference`, `Hub.setProjectPreference`, and `Hub.rollbackPreview`. `projectPlanning` must degrade when Git history is unavailable and must not fail project loading solely because Git history fails.

- [ ] **Step 4: Add routes and API wrappers**

```ts
preflightVersion: (slug: string, body: unknown) => post(`/api/projects/${enc(slug)}/version-preflight`, body),
projectPlanning: (slug: string) => get(`/api/projects/${enc(slug)}/planning`),
projectPreference: (slug: string) => get(`/api/projects/${enc(slug)}/preferences`),
setProjectPreference: (slug: string, body: unknown) => put(`/api/projects/${enc(slug)}/preferences`, body),
rollbackPreview: (slug: string) => get(`/api/projects/${enc(slug)}/rollback-preview`),
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `node --test test/projects.test.js test/v07-upgrade.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/core/project-preferences.js src/core/service.js src/server/routes.js test/projects.test.js test/v07-upgrade.test.js web/src/services/api.ts
git commit -m "feat: expose project publishing planning APIs"
```

### Task 3: Publishing model and batch queue

**Files:**
- Modify: `web/src/components/newVersionModel.js`
- Modify: `web/src/components/newVersionModel.test.js`

- [ ] **Step 1: Write failing model tests**

```js
test('suggests dotted versions and never guesses labels', () => {
  assert.equal(suggestVersionNo('v2.3.9'), 'v2.3.10')
  assert.equal(suggestVersionNo('final'), '')
})

test('builds an ordered batch queue with per-file errors', () => {
  const queue = buildBatchQueue([
    { name: 'demo-v2.html', size: 10 },
    { name: 'notes.txt', size: 10 },
  ], { maxBytes: 100, existingVersionNos: ['v1'] })
  assert.equal(queue[0].suggestedVersionNo, 'v2')
  assert.equal(queue[1].error, '仅支持 .html 或 .htm 文件')
})
```

Also cover manual-value protection, publish result normalization, review summary Markdown, metadata reuse, and queue result aggregation.

- [ ] **Step 2: Run the model test and verify it fails**

Run: `node --test web/src/components/newVersionModel.test.js`

Expected: FAIL because the new exports are missing.

- [ ] **Step 3: Implement the minimal pure helpers**

```js
export function suggestVersionNo(value) {
  const match = /^v(\d+(?:\.\d+)*)$/i.exec(String(value || '').trim())
  if (!match) return ''
  const parts = match[1].split('.').map(Number)
  parts[parts.length - 1] += 1
  return `v${parts.join('.')}`
}

export function reusableMetadata(version = {}) {
  return {
    requirements: Array.isArray(version.requirements) ? structuredClone(version.requirements) : [],
    tags: Array.isArray(version.tags) ? [...version.tags] : [],
    locations: [...new Set((version.changes || []).map((item) => String(item.location || '').trim()).filter(Boolean))],
  }
}
```

- [ ] **Step 4: Run the model test and verify it passes**

Run: `node --test web/src/components/newVersionModel.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add web/src/components/newVersionModel.js web/src/components/newVersionModel.test.js
git commit -m "feat: add publishing and batch queue models"
```

### Task 4: Quick publishing UI and result closure

**Files:**
- Modify: `web/src/components/NewVersionDialog.tsx`
- Modify: `web/src/styles/global.css`

- [ ] **Step 1: Replace the one-shot submit state with source, preflight, publishing, and result states**

Add state with exact shapes:

```ts
type PublishResult = {
  project: string;
  versionNo: string;
  title: string;
  changeCount: number;
  requirementCount: number;
  externalRefCount: number;
  baselineVersionNo: string;
  gitState: 'local' | 'syncing' | 'synced' | 'failed';
  syncError?: string;
};
```

The submit path must call `api.preflightVersion` before `api.addVersion`, render field-level blockers, require warning confirmation, and preserve user input after failures.

- [ ] **Step 2: Add automatic suggestion and manual-value protection**

Load project versions when the dialog opens. Use the latest version only for an editable suggestion. Track `versionTouched` and `titleTouched`; source reinspection must not overwrite touched fields.

- [ ] **Step 3: Add compact change entry, reusable metadata, and multi-file queue**

Use the existing `ChangeEditor` and `RequirementEditor`. “参考上一版” copies requirements and exposes location suggestions but never copies old descriptions. Multi-file selection creates a queue; create valid confirmed rows sequentially, retain failed rows with errors, and show a result per row.

- [ ] **Step 4: Add result actions**

```ts
await navigator.clipboard.writeText(reviewMarkdown(result));
await api.gitSync(`feat: 发布 ${result.project}/${result.versionNo}`);
```

Provide “打开工作台”, “同步到 Git”, and “复制评审摘要”. A sync failure must keep the created version and show the Git error.

- [ ] **Step 5: Build the web app**

Run: `cd web && npm run build`

Expected: Vite build succeeds with no TypeScript error.

- [ ] **Step 6: Commit Task 4**

```bash
git add web/src/components/NewVersionDialog.tsx web/src/styles/global.css
git commit -m "feat: close the quick publishing workflow"
```

### Task 5: Project version planning model

**Files:**
- Modify: `web/src/pages/projectVersionsModel.js`
- Modify: `web/src/pages/projectVersionsModel.test.js`

- [ ] **Step 1: Write failing tests for task filters, comparison targets, query state, and export**

```js
test('filters review tasks independently from lifecycle', () => {
  assert.deepEqual(filterVersions(versions, { task: 'pending' }).map(versionNo), ['v3'])
  assert.deepEqual(filterVersions(versions, { task: 'questions' }).map(versionNo), ['v2'])
  assert.deepEqual(filterVersions(versions, { task: 'baseline-history' }).map(versionNo), ['v1'])
})

test('chooses only valid distinct common comparison targets', () => {
  assert.deepEqual(comparisonTargets(versions, 'v2', 'v3', 'v1'), {
    selectedVsBaseline: { a: 'v2', b: 'v3' },
    latestVsBaseline: { a: 'v2', b: 'v3' },
    baselineVsPrevious: { a: 'v1', b: 'v2' },
  })
})
```

Also cover author, requirement, external-resource filters and URL query round trips.

- [ ] **Step 2: Run the model test and verify it fails**

Run: `node --test web/src/pages/projectVersionsModel.test.js`

Expected: FAIL because the new options and exports are missing.

- [ ] **Step 3: Implement pure project planning helpers**

Extend `filterVersions` without mutating input. Add `comparisonTargets`, `projectFilterQuery`, `projectFilterState`, `reviewStateOf`, and `planningBadges`. Keep query serialization stable and omit defaults.

- [ ] **Step 4: Run the model test and verify it passes**

Run: `node --test web/src/pages/projectVersionsModel.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add web/src/pages/projectVersionsModel.js web/src/pages/projectVersionsModel.test.js
git commit -m "feat: add project version planning models"
```

### Task 6: Project command view, history, filtering, and rollback preview

**Files:**
- Modify: `web/src/pages/ProjectVersions.tsx`
- Modify: `web/src/pages/ProjectVersions.module.css`

- [ ] **Step 1: Load planning, preferences, watch items, and URL state without blocking core project rendering**

Use `Promise.allSettled` for optional planning/history/watch data. Project and version loading remain authoritative; Git history failure must become a warning in the history drawer, not a page error.

- [ ] **Step 2: Upgrade the baseline strip into the command view**

Render current baseline title, owner, timestamp, requirement count, cumulative ADD/MODIFY/REMOVE counts, pending/questions badges, and actions for open, previous comparison, pending filter, history, and rollback.

- [ ] **Step 3: Add dual-state rows and task filters**

Show lifecycle and review tags together. Add task chips for all, pending, questions, baseline history, and void. Add optional author, requirement, and external-resource controls in an expandable filter area. Keep search, sort, keyboard selection, and mobile drawer behavior.

- [ ] **Step 4: Add common compare, history, trace, and rollback interactions**

Selected-version actions must include “与当前基线比较”. The history drawer uses `api.baselineHistory`. The rollback modal loads `api.rollbackPreview`, displays withdrawn changes and requirements, then calls the existing rollback endpoint. Result panels expose copy/open/compare actions.

- [ ] **Step 5: Persist filters and expose the watch entry**

Write filters to URL immediately and debounce `api.setProjectPreference`. Show project watch count linking to `/watch?project=<slug>`.

- [ ] **Step 6: Build and run focused model tests**

Run: `node --test web/src/pages/projectVersionsModel.test.js && cd web && npm run build`

Expected: model tests and Vite build pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git commit -m "feat: turn project versions into a command view"
```

### Task 7: Project-scoped watch inbox and personal filters

**Files:**
- Modify: `web/src/pages/WatchInbox.tsx`
- Modify: `web/src/styles/global.css`
- Modify: `test/watch.test.js`

- [ ] **Step 1: Write a failing watch filter test**

Add this pure helper and test its two branches:

```js
export function filterWatchItems(items = [], project = '') {
  const slug = String(project || '').trim()
  return slug ? items.filter((item) => item.project === slug) : [...items]
}

assert.deepEqual(filterWatchItems(items, 'orders').map((item) => item.id), ['orders-1'])
assert.equal(filterWatchItems(items, '').length, items.length)
```

- [ ] **Step 2: Implement project query filtering**

Read `project` with `useSearchParams`, filter the loaded list, display “当前项目” context, and provide “查看全部草稿”. Archived and failed actions retain existing behavior.

- [ ] **Step 3: Run watch tests and build**

Run: `node --test test/watch.test.js && cd web && npm run build`

Expected: tests and build pass.

- [ ] **Step 4: Commit Task 7**

```bash
git add web/src/pages/WatchInbox.tsx web/src/styles/global.css test/watch.test.js
git commit -m "feat: scope watch inbox to a project"
```

### Task 8: Trace Markdown in Compare

**Files:**
- Modify: `web/src/pages/compareModel.js`
- Modify: `web/src/pages/compareModel.test.js`
- Modify: `web/src/pages/Compare.tsx`

- [ ] **Step 1: Write a failing Markdown export test**

```js
test('renders trace markdown with range, counts, grouped items and requirements', () => {
  const markdown = traceMarkdown({ project: '订单', from: 'v1', to: 'v2', cumulative })
  assert.match(markdown, /订单 · v1 → v2/)
  assert.match(markdown, /新增 1/)
  assert.match(markdown, /REQ-1/)
})
```

- [ ] **Step 2: Implement deterministic Markdown and copy action**

The helper must escape pipes/newlines and preserve item order. Add “复制追溯摘要” beside existing comparison actions; disable it while cumulative changes are unavailable.

- [ ] **Step 3: Run tests and build**

Run: `node --test web/src/pages/compareModel.test.js && cd web && npm run build`

Expected: tests and build pass.

- [ ] **Step 4: Commit Task 8**

```bash
git add web/src/pages/compareModel.js web/src/pages/compareModel.test.js web/src/pages/Compare.tsx
git commit -m "feat: export version trace summaries"
```

### Task 9: Full verification and completion audit

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run all Node tests**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run production build**

Run: `npm run build:web`

Expected: Vite production build succeeds.

- [ ] **Step 3: Run browser acceptance**

Start a temporary Flowlark repository and verify at 1440, 1024, 768, and 390 px:

```text
quick publish: file, paste, URL, preflight blocker, warning confirmation, result copy
baseline command: no baseline, one baseline, previous baseline, pending/questions badges
compare: baseline vs previous, selected vs baseline, copied trace Markdown
history: Git available and unavailable fallback
rollback: preview, confirm, resulting baseline
watch: project-scoped and all items
read-only: every write action disabled
```

Expected: no page overlap, no runtime error, and no console error.

- [ ] **Step 4: Audit F01–F17 against current code and evidence**

For every feature, record the implementing file/function and at least one test or browser observation. Missing or indirect evidence means the feature is not complete.

- [ ] **Step 5: Commit verification fixes**

```bash
git add src/core/version-planning.js src/core/project-preferences.js src/core/rules.js src/core/service.js src/server/routes.js \
  web/src/services/api.ts web/src/components/newVersionModel.js web/src/components/newVersionModel.test.js \
  web/src/components/NewVersionDialog.tsx web/src/pages/projectVersionsModel.js web/src/pages/projectVersionsModel.test.js \
  web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css web/src/pages/WatchInbox.tsx \
  web/src/pages/compareModel.js web/src/pages/compareModel.test.js web/src/pages/Compare.tsx web/src/styles/global.css \
  test/version-planning.test.js test/review.test.js test/projects.test.js test/v07-upgrade.test.js test/watch.test.js
git commit -m "test: verify project prototype management upgrade"
```

- [ ] **Step 6: Confirm unrelated user changes remain untouched**

Run: `git status --short`

Expected: the pre-existing `AppShell.tsx`, `NotFound.tsx`, `.codex-ui-regression/`, and `test-results/` changes remain separate unless an implementation requirement explicitly needed one of them.

## Spec coverage map

| Feature | Implementation task |
|---|---|
| F01 quick publishing | Task 4 |
| F02 multi-source import and smart defaults | Tasks 3–4 |
| F03 compact change entry | Task 4 |
| F04 preflight | Tasks 1–2 and 4 |
| F05 publish result | Tasks 3–4 |
| F06 baseline command view | Tasks 2 and 6 |
| F07 review queue and dual states | Tasks 5–6 |
| F08 common comparisons | Tasks 5–6 |
| F09 baseline preflight | Tasks 1–2 and 6 |
| F10 baseline result | Task 6 |
| F11 watch entry | Tasks 6–7 |
| F12 multi-file queue | Tasks 3–4 |
| F13 metadata reuse | Tasks 3–4 |
| F14 baseline history | Tasks 2 and 6 |
| F15 advanced filters and shareable views | Tasks 2, 5, and 6 |
| F16 trace export | Tasks 1 and 8 |
| F17 rollback preview | Tasks 2 and 6 |
