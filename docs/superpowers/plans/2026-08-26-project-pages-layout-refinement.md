# Project Pages Layout Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the project table and rebuild the project-version page into a compact project summary, version status strip, master-detail browser, and actionable empty state.

**Architecture:** Keep all backend contracts and version workflows unchanged. Make the project list derive only visible searchable fields, then reorganize `ProjectVersions` using its existing data, callbacks, keyboard model, and detail cache; CSS Modules own the new page layout while global CSS remains limited to the existing project table.

**Tech Stack:** React 19, TypeScript/TSX, React Router 7, Ant Design 6, CSS Modules, existing Flowlark tokens, Node built-in test runner, Vite 5, Python Playwright for browser acceptance.

---

## Working-Tree Constraint

- Preserve all pre-existing modified, deleted, and untracked files.
- Stage only the exact files named by each task.
- Do not use `git add .`, `git add -A`, reset, checkout, or cleanup commands.
- Approved design: `docs/superpowers/specs/2026-08-26-project-pages-layout-refinement-design.md`.

## File Map

Modify:

- `web/src/pages/projectsModel.js`: remove hidden description from project search.
- `web/src/pages/projectsModel.test.js`: lock the visible-field search contract.
- `web/src/pages/Projects.tsx`: remove the description column and replace filled status tags with status badges.
- `web/src/pages/ProjectVersions.tsx`: add project metadata, unify version status, move the void toggle, and add an actionable empty state.
- `web/src/pages/ProjectVersions.module.css`: implement compact page layers, empty state, and responsive behavior.

No backend, API, storage, route, or shared `PageHeader` changes are required.

### Task 1: Simplify the Project Table

**Files:**

- Modify: `web/src/pages/projectsModel.js`
- Modify: `web/src/pages/projectsModel.test.js`
- Modify: `web/src/pages/Projects.tsx`

- [ ] **Step 1: Add a failing visible-field search assertion**

Update the first test in `web/src/pages/projectsModel.test.js` so a description-only query returns no projects:

```js
test('filters project rows by visible query fields, priority, and archive state', () => {
  assert.deepEqual(filterProjects(items, { query: '华油' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { query: 'HYZL' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { query: '安全生产' }).map((item) => item.slug), [])
  assert.deepEqual(filterProjects(items, { priority: 'P1' }).map((item) => item.slug), ['hyzl'])
  assert.deepEqual(filterProjects(items, { archived: 'archived' }).map((item) => item.slug), ['legacy'])
  assert.deepEqual(filterProjects(items, { archived: 'active' }).map((item) => item.slug), ['hyzl'])
})
```

- [ ] **Step 2: Run the model test and verify it fails**

```bash
node --test web/src/pages/projectsModel.test.js
```

Expected: the description-only query returns `hyzl`, proving the current model still searches a hidden field.

- [ ] **Step 3: Restrict the project search haystack**

Change `filterProjects` in `web/src/pages/projectsModel.js` to:

```js
export function filterProjects(items = [], { query = '', priority = '', archived = 'all' } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  return items.filter((item) => {
    const haystack = `${item.name || ''} ${item.code || ''}`.toLowerCase()
    return (!needle || haystack.includes(needle))
      && (!priority || item.priority === priority)
      && (archived === 'all' || (archived === 'archived' ? item.archived === true : item.archived !== true))
  })
}
```

- [ ] **Step 4: Remove the description column and normalize status rendering**

In `web/src/pages/Projects.tsx`:

- Add `Badge` to the Ant Design import.
- Remove `Tooltip` from the import.
- Change the search placeholder to `搜索项目名称或代码`.
- Delete the `项目描述` column.
- Replace the status column with:

```tsx
{
  title: '状态',
  dataIndex: 'archived',
  width: 120,
  render: (value) => (
    <Badge status={value ? 'default' : 'success'} text={value ? '已归档' : '进行中'} />
  ),
},
```

- Change the table scroll width from `1180` to `1030`.

- [ ] **Step 5: Run the project model test and production build**

```bash
node --test web/src/pages/projectsModel.test.js
npm run build:web
```

Expected: all project model tests pass; Vite exits 0 with only the existing chunk warning and audit findings.

- [ ] **Step 6: Commit the project-table cleanup**

```bash
git add web/src/pages/projectsModel.js web/src/pages/projectsModel.test.js web/src/pages/Projects.tsx
git diff --cached --check
git commit -m "refactor: simplify project table content"
```

### Task 2: Rebuild the Project-Version Page Structure

**Files:**

- Modify: `web/src/pages/ProjectVersions.tsx`
- Modify: `web/src/pages/ProjectVersions.module.css`

- [ ] **Step 1: Add the empty-state icon and remove the generic Empty dependency for page emptiness**

Keep `Empty` for version detail sections and add `FileAddOutlined` to the icon import:

```tsx
import {
  ArrowRightOutlined,
  DownloadOutlined,
  FileAddOutlined,
  FileTextOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
```

- [ ] **Step 2: Remove the description and global void toggle from PageHeader**

Use:

```tsx
<PageHeader
  eyebrow="项目版本"
  title={project?.name || slug}
  backTo="/projects"
  actions={(
    <Button
      type="primary"
      icon={<PlusOutlined />}
      disabled={!canWrite}
      onClick={() => setNewVersionOpen(true)}
    >
      新建版本
    </Button>
  )}
/>
```

- [ ] **Step 3: Add the compact project metadata row**

Immediately after `PageHeader`, render:

```tsx
<section className={styles.projectMeta} aria-label="项目摘要">
  <span><small>项目代码</small><strong className="fl-mono">{textOf(project?.code, slug)}</strong></span>
  <span><small>优先级</small><strong>{textOf(project?.priority, '未设置')}</strong></span>
  <span><small>版本总数</small><strong>{versions.length}</strong></span>
  <span><small>当前基线</small><strong className="fl-mono">{baseline ? versionNoOf(baseline) : '未设置'}</strong></span>
  <span><small>最近更新</small><strong>{fmtTime(project?.updatedAt)}</strong></span>
</section>
```

- [ ] **Step 4: Replace separate new-version and baseline notices with one status strip**

Delete the standalone `newCount` success `Alert`, the baseline-only strip, and the no-baseline warning. When `versions.length > 0`, render:

```tsx
<section className={styles.baselineStrip} aria-label="版本状态摘要">
  <div className={styles.baselineMain}>
    <span className={styles.baselineKicker}>{baseline ? '当前基线' : '基线状态'}</span>
    <strong className="fl-mono">{baseline ? versionNoOf(baseline) : '未设置'}</strong>
    <span className={styles.baselineTitle}>
      {baseline ? textOf(baseline.title, '未命名版本') : '选择一个有变更日志的版本设为基线'}
    </span>
    {newCount > 0 ? <span className={styles.readMarker}>{newCount} 个新版本</span> : null}
  </div>
  {baseline ? (
    <span className={styles.baselineMeta}>
      {createdByOf(baseline)} · {fmtTime(baseline.baselineAt || createdAtOf(baseline))}
    </span>
  ) : null}
  <Space wrap>
    {newCount > 0 ? <Button size="small" onClick={() => void markRead(versionNoOf(versions[0]))}>标记最新为已读</Button> : null}
    {baseline && canRollback ? <Button disabled={!canWrite} onClick={rollbackBaseline}>回滚上一版</Button> : null}
    {baseline ? <Button onClick={() => void selectVersion(versionNoOf(baseline), { openMobile: true })}>查看详情</Button> : null}
    {baseline ? <Button onClick={() => openWorkbench(versionNoOf(baseline))}>打开工作台</Button> : null}
  </Space>
</section>
```

Remove the duplicate “回滚上一版” button from `renderVersionSummary`; retain non-baseline “设为基线/回滚为基线”.

- [ ] **Step 5: Move the void toggle into the version index**

Below `.indexFilters`, add:

```tsx
<div className={styles.indexOptions}>
  <Checkbox checked={includeVoid} onChange={(event) => setIncludeVoid(event.target.checked)}>
    显示已废弃版本
  </Checkbox>
</div>
```

- [ ] **Step 6: Replace the generic page empty state**

Use this for `!loading && !pageError && versions.length === 0`:

```tsx
<section className={styles.pageEmpty} aria-label="项目版本空状态">
  <span className={styles.emptyIcon} aria-hidden><FileAddOutlined /></span>
  <h2>还没有版本</h2>
  <p>创建首个版本后，可以在这里查看原型、变更和关联需求。</p>
  <Button type="primary" icon={<PlusOutlined />} disabled={!canWrite} onClick={() => setNewVersionOpen(true)}>
    创建首个版本
  </Button>
  <Checkbox checked={includeVoid} onChange={(event) => setIncludeVoid(event.target.checked)}>
    显示已废弃版本
  </Checkbox>
</section>
```

- [ ] **Step 7: Implement the page layers and responsive CSS**

In `ProjectVersions.module.css`:

- Reduce the page-header bottom margin inside this page.
- Add a five-column `.projectMeta` with compact labels and values.
- Keep `.baselineStrip` lightweight and wrapping.
- Change `.pageSkeleton` and `.pageEmpty` to a 260px minimum height.
- Center the empty-state content and use a token-based icon container.
- Add `.indexOptions` below the filters.
- Recalculate the browser height for the extra metadata row.
- At 899px and below, make project metadata wrap into three columns.
- At 768px and below, use two columns.
- At 480px and below, use one column and keep the existing detail drawer behavior.

Use these exact new core rules:

```css
.page :global(.fl-page-head) { margin-bottom: var(--fl-s-3); }
.projectMeta { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--fl-s-2); margin-bottom: var(--fl-s-4); padding: var(--fl-s-3) var(--fl-s-4); border: 1px solid var(--fl-line); border-radius: var(--fl-r-3); background: var(--fl-surface); box-shadow: var(--fl-shadow-1); }
.projectMeta span { display: grid; min-width: 0; gap: var(--fl-s-1); }
.projectMeta small { color: var(--fl-text-2); font-size: var(--fl-fs-2); }
.projectMeta strong { min-width: 0; overflow: hidden; color: var(--fl-text); font-size: var(--fl-fs-3); text-overflow: ellipsis; white-space: nowrap; }
.pageSkeleton, .pageEmpty { min-height: 260px; padding: var(--fl-s-5); border: 1px solid var(--fl-line); border-radius: var(--fl-r-3); background: var(--fl-surface); }
.pageEmpty { display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; }
.pageEmpty h2 { margin: var(--fl-s-3) 0 var(--fl-s-1); color: var(--fl-text); font-size: var(--fl-fs-5); }
.pageEmpty p { max-width: 440px; margin: 0 0 var(--fl-s-4); color: var(--fl-text-2); }
.pageEmpty :global(.ant-checkbox-wrapper) { margin-top: var(--fl-s-3); }
.emptyIcon { display: inline-grid; width: 48px; height: 48px; place-items: center; border-radius: 50%; background: var(--fl-primary-bg); color: var(--fl-primary-deep); font-size: 22px; }
.indexOptions { margin-top: var(--fl-s-2); color: var(--fl-text-2); font-size: var(--fl-fs-2); }
.versionBrowser { height: calc(100dvh - 320px); min-height: 520px; }
```

- [ ] **Step 8: Run focused tests and build**

```bash
node --test web/src/pages/projectVersionsModel.test.js web/src/pages/projectsModel.test.js
npm run build:web
```

Expected: model tests pass and Vite exits 0.

- [ ] **Step 9: Commit the version-page redesign**

```bash
git add web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git diff --cached --check
git commit -m "refactor: reorganize project version page"
```

### Task 3: Full Regression and Browser Acceptance

**Files:**

- Verify only; modify only the five task-owned frontend files if a verified regression requires a fix.

- [ ] **Step 1: Run all tests**

```bash
node --test | tail -n 12
```

Expected: all tests pass, zero failures.

- [ ] **Step 2: Build production assets**

```bash
npm run build:web
```

Expected: Vite exits 0 with only existing non-blocking warnings.

- [ ] **Step 3: Verify the empty project at 1440, 1024, 768, and 390px**

Use a temporary Flowlark repository and native Python Playwright. At every size verify:

- project description text is absent;
- project metadata is visible;
- empty state contains `FileAddOutlined`, the guidance copy, and “创建首个版本”;
- empty container is approximately 260px high rather than filling the page;
- no page-level horizontal overflow;
- console and page error arrays are empty.

- [ ] **Step 4: Verify a populated project at desktop and mobile**

Verify:

- unified status strip shows baseline, new-version marker, and applicable actions;
- void toggle is inside the index toolbar;
- version filters, keyboard selection, workbench navigation, baseline actions, and mobile detail drawer still work;
- project list has no description column and uses `Badge` dot + text statuses.

- [ ] **Step 5: Commit a scoped verification fix only if needed**

If a browser assertion identifies a defect, stage only the exact changed paths from the file map and commit:

```bash
git add web/src/pages/projectsModel.js web/src/pages/projectsModel.test.js web/src/pages/Projects.tsx web/src/pages/ProjectVersions.tsx web/src/pages/ProjectVersions.module.css
git diff --cached --check
git commit -m "fix: complete project page layout refinement"
```

If no fix is needed, do not create an empty commit.
